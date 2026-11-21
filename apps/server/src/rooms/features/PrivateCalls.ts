import type { Client } from "colyseus";
import { MoveRefused, PlatformUnavailable, platform } from "../../platform/platform.js";
import { CALL_RANGE } from "../../town/calls.js";
import { TownFeature, type MessageHandler } from "./TownFeature.js";
/** 邀請多久沒回就失效（毫秒）。 */
const INVITE_MS = 30_000;
/** 同一個人多久才能再發一次邀請（毫秒），避免一直跳邀請給別人。 */
const INVITE_COOLDOWN_MS = 10_000;

type Invite = { from: string; to: string; until: number };

/**
 * 一對一通話：點身邊的人邀請，對方接受後，bot 開一個只有兩個人看得到的語音頻道，把兩個人搬進去。
 * 兩個人都離開後頻道自動刪掉（平台轉接層處理）。
 */
export class PrivateCalls extends TownFeature {
    /** 還沒回覆的邀請，key 是「邀請人 sessionId>被邀請人 sessionId」。 */
    private invites = new Map<string, Invite>();
    /** 每個帳號上次發邀請的時間。 */
    private lastInvite = new Map<string, number>();

    messages(): Record<string, MessageHandler> {
        return {
            callInvite: (client, payload) => this.invite(client, (payload as { to?: unknown } | null)?.to),
            callAnswer: (client, payload) => {
                const { from, accept } = (payload ?? {}) as { from?: unknown; accept?: unknown };
                void this.answer(client, from, accept === true);
            },
        };
    }

    onLeave(client: Client) {
        for (const [key, invite] of this.invites) if (invite.from === client.sessionId || invite.to === client.sessionId) this.invites.delete(key);
    }

    private invite(client: Client, to: unknown) {
        const tell = (ok: boolean, message: string) => client.send("callResult", { ok, message });
        const { state, clock } = this.town;
        const me = state.characters.get(client.sessionId);
        const target = typeof to === "string" ? state.characters.get(to) : undefined;
        if (!me || !target || to === client.sessionId) return tell(false, "找不到這個人");
        if (target.userId === me.userId) return tell(false, "不能打給自己");
        if (Math.hypot(target.position.x - me.position.x, target.position.y - me.position.y) > CALL_RANGE) return tell(false, "要走近一點才能邀請");
        const last = this.lastInvite.get(client.auth.id);
        if (last !== undefined && clock.currentTime - last < INVITE_COOLDOWN_MS) return tell(false, "剛邀請過，等一下再試");

        this.lastInvite.set(client.auth.id, clock.currentTime);
        this.invites.set(`${client.sessionId}>${to}`, { from: client.sessionId, to: to as string, until: clock.currentTime + INVITE_MS });
        this.town.clientOf(to as string)?.send("callInvite", { from: client.sessionId, name: me.name });
        tell(true, `已邀請 ${target.name}，等對方回覆`);
    }

    /** 被邀請的人回覆：拒絕就告訴邀請人；接受就開頻道、把兩個人搬進去（兩個人都要已經在語音裡）。 */
    private async answer(client: Client, from: unknown, accept: boolean) {
        const key = `${from}>${client.sessionId}`;
        const invite = this.invites.get(key);
        const tellMe = (ok: boolean, message: string) => client.send("callResult", { ok, message });
        if (!invite || invite.until < this.town.clock.currentTime) {
            this.invites.delete(key);
            return tellMe(false, "這個邀請已經失效了");
        }
        this.invites.delete(key);
        const inviter = this.town.clientOf(invite.from);
        const tellBoth = (ok: boolean, message: string) => {
            tellMe(ok, message);
            inviter?.send("callResult", { ok, message });
        };
        const meName = client.auth.name;
        if (!accept) return inviter?.send("callResult", { ok: false, message: `${meName} 現在不方便通話` });
        if (!inviter) return tellMe(false, "對方已經離開小鎮了");

        try {
            const inVoice = new Set((await platform().voiceMembers(this.town.guildId)).map((m) => m.userId));
            const missing = [client, inviter].filter((c) => !inVoice.has(c.auth.id)).map((c) => c.auth.name);
            if (missing.length) return tellBoth(false, `${missing.join("、")} 要先在 Discord 加入任一個語音頻道，才能搬進通話`);
            const channelId = await platform().createPrivateCall(
                this.town.guildId,
                [inviter.auth.id, client.auth.id],
                `📞 ${inviter.auth.name} 和 ${meName}`,
            );
            for (const c of [inviter, client]) await platform().moveToVoice(this.town.guildId, c.auth.id, channelId);
            tellBoth(true, "一對一通話開好了，只有你們兩個看得到這個頻道");
        } catch (e) {
            if (e instanceof MoveRefused) tellBoth(false, e.message);
            else if (e instanceof PlatformUnavailable) tellBoth(false, "暫時連不上 Discord，沒辦法開通話");
            else {
                console.error("開一對一通話失敗", e);
                tellBoth(false, "開通話失敗，請稍後再試");
            }
        }
    }
}
