import type { Client } from "colyseus";
import { platform, MoveRefused, PlatformUnavailable, type VoiceMember } from "../../platform/platform.js";
import type { ChannelRoom } from "../../town/layoutTown.js";
import { placeVoiceFigures } from "../../town/placeVoiceFigures.js";
import { VoiceFigure } from "../schema/TownState.js";
import type { RoomChangeCause, Town } from "../Town.js";
import { TownFeature } from "./TownFeature.js";

/**
 * 語音房：
 * - 在語音頻道裡的人（有沒有打開小鎮都算）站在對應的語音房裡，頭上顯示動態
 * - 自己走進語音房時，請平台把他搬到那個語音頻道
 */
export class VoiceRooms extends TownFeature {
    /** 正在幫誰搬頻道、最後想去哪個語音房，key 是帳號 ID。 */
    private movingTo = new Map<string, ChannelRoom>();
    private version = 0;
    private stopWatching: () => void;

    constructor(town: Town) {
        super(town);
        this.stopWatching = platform().onVoiceChanged(town.guildId, () =>
            this.refresh().catch((e) => console.error("更新語音狀態失敗", e)),
        );
    }

    onRoomChanged(client: Client, room: ChannelRoom | undefined, _before: string | undefined, cause: RoomChangeCause) {
        if (cause === "walk" && room?.kind === "voice") void this.moveIntoVoice(client, room);
    }

    /** 房間位置變了，語音房裡的人要重新站位；失敗不影響地圖。 */
    async onLayoutChanged() {
        await this.refresh().catch((e) => console.error("更新語音狀態失敗", e));
    }

    dispose() {
        this.stopWatching();
    }

    /** 依目前語音頻道裡的人，更新站在語音房裡的成員。 */
    async refresh() {
        const version = ++this.version;
        let members: VoiceMember[] = [];
        try {
            members = await platform().voiceMembers(this.town.guildId);
        } catch (e) {
            if (!(e instanceof PlatformUnavailable)) throw e;
            console.warn("讀不到語音狀態：", e.message);
            return; // 暫時連不上就保留原本的樣子，不要讓語音房裡的人整批消失
        }
        // 語音事件連續來時會同時讀好幾次；只採用最後一次發出的
        if (version !== this.version) return;

        const voice = this.town.state.voice;
        const placed = placeVoiceFigures(this.town.layout.rooms, members);
        const present = new Set(placed.map((p) => p.userId));
        voice.forEach((_figure, userId) => {
            if (!present.has(userId)) voice.delete(userId);
        });
        for (const { userId, ...figure } of placed) {
            const existing = voice.get(userId);
            if (existing) Object.assign(existing, figure);
            else voice.set(userId, new VoiceFigure(figure));
        }
    }

    /**
     * 走進語音房：請平台把這位成員搬到那個語音頻道，結果告訴他。
     * 同一個人同時只送一個搬人請求；搬的途中又走進別的語音房，搬完再去最後走進的那間（快速進出門不會排一長串請求）。
     */
    async moveIntoVoice(client: Client, room: ChannelRoom) {
        const userId = client.auth.id;
        const inFlight = this.movingTo.has(userId);
        this.movingTo.set(userId, room);
        if (inFlight) return;

        const say = (ok: boolean, message: string) => client.send("voiceMove", { ok, message });
        try {
            let target: ChannelRoom | undefined;
            while ((target = this.movingTo.get(userId)) !== undefined) {
                try {
                    const result = await platform().moveToVoice(client.auth.guildId, userId, target.id);
                    if (this.movingTo.get(userId) !== target) continue; // 途中又換了房間，直接去新的
                    if (result === "moved") say(true, `已切到語音頻道「${target.name}」`);
                    if (result === "not-in-voice") say(false, "請先在 Discord 加入任一個語音頻道，走進語音房才能幫你切換");
                } catch (e) {
                    if (e instanceof MoveRefused) say(false, e.message);
                    else if (e instanceof PlatformUnavailable) say(false, "暫時連不上 Discord，沒辦法切換語音頻道");
                    else {
                        console.error("搬語音頻道失敗", e);
                        say(false, "切換語音頻道失敗，請稍後再試");
                    }
                }
                if (this.movingTo.get(userId) === target) break;
            }
        } finally {
            this.movingTo.delete(userId);
        }
    }
}
