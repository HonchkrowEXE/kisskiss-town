import type { Client } from "colyseus";
import { database } from "../../db.js";
import { MemberSettings } from "../../members/MemberSettings.js";
import { platform } from "../../platform/platform.js";
import { roomAt } from "../../town/layoutTown.js";
import { findSlapTarget, knockback } from "../../town/slap.js";
import type { Direction } from "../schema/TownState.js";
import { memberOf } from "../Town.js";
import { TownFeature, type MessageHandler } from "./TownFeature.js";

/** 搧巴掌的冷卻時間（毫秒），每位成員各算各的。 */
const SLAP_COOLDOWN_MS = 10_000;

/** 搧巴掌：搧旁邊的人，對方退一格，Discord 發通知。成員可以關掉「可被搧」。 */
export class Slapping extends TownFeature {
    settings = new MemberSettings(database());
    /** 每位成員上次搧中別人的時間，key 是帳號 ID。 */
    private lastSlapAt = new Map<string, number>();

    messages(): Record<string, MessageHandler> {
        return {
            slap: (client) => this.slap(client),
            setSlappable: (client, value) => this.setSlappable(client, value),
        };
    }

    onJoin(client: Client) {
        this.town.state.characters.get(client.sessionId)!.slappable = this.settings.slappable(memberOf(client));
    }

    /** 搧旁邊的人：命中與打退的位置都由伺服器決定，結果告訴搧的人，動畫廣播給所有人，再到 Discord 發通知。 */
    private slap(client: Client) {
        const { state, clock, layout, walkable } = this.town;
        const me = state.characters.get(client.sessionId);
        if (!me) return;
        const say = (ok: boolean, message: string) => client.send("slapResult", { ok, message });

        const now = clock.currentTime;
        const last = this.lastSlapAt.get(client.auth.id);
        if (last !== undefined && now - last < SLAP_COOLDOWN_MS) {
            return say(false, `冷卻中，還要 ${Math.ceil((SLAP_COOLDOWN_MS - (now - last)) / 1000)} 秒`);
        }
        const found = findSlapTarget(me, state.characters.entries());
        if (!found) return say(false, "旁邊沒有人可以搧");
        const [targetId, target] = found;
        if (!target.slappable) return say(false, `${target.name} 關掉了「可被搧」`);

        this.lastSlapAt.set(client.auth.id, now);
        // 坐在遊戲桌的人被搧不會離開座位
        const to = target.seatedAt ? { ...target.position } : knockback(me.position, target.position, me.dir as Direction, walkable);
        target.position.x = to.x;
        target.position.y = to.y;
        // 被打退不算自己走進房間，不會因此被搬頻道
        this.town.placeIn(targetId, roomAt(layout.rooms, to.x, to.y), "other");
        this.town.holdStill(targetId);
        this.town.clientOf(targetId)?.send("slapped", { x: to.x, y: to.y, dir: target.dir });

        this.town.sendToAll("slap", { from: client.sessionId, to: targetId });
        say(true, `啪！你搧了 ${target.name}`);
        platform()
            .announce(this.town.guildId, `👋 ${me.name} 在親親小鎮搧了 ${target.name} 一巴掌！`, this.town.townSettings.notifyChannel(this.town.guildId))
            .catch((e) => console.warn("搧巴掌通知發不出去：", e instanceof Error ? e.message : e));
    }

    /** 成員自己開關「可被搧」，存進資料庫，他每個分頁的角色都一起改。 */
    private setSlappable(client: Client, value: unknown) {
        if (typeof value !== "boolean" || this.town.state.characters.get(client.sessionId)?.slappable === value) return;
        this.settings.setSlappable(memberOf(client), value);
        this.town.forEachCharacterOf(client.auth.id, (character) => (character.slappable = value));
    }
}
