import type { Client } from "colyseus";
import { platform, PlatformUnavailable, TextRefused } from "../../platform/platform.js";
import type { ChannelRoom } from "../../town/layoutTown.js";
import type { Town } from "../Town.js";
import { TownFeature, type MessageHandler } from "./TownFeature.js";

/** 在文字房發言的最短間隔（毫秒），每位成員各算各的。 */
const SAY_INTERVAL_MS = 1000;

/** 一則訊息最多幾個字（Discord 的上限）。 */
const MAX_MESSAGE_LENGTH = 2000;

/** 文字房：走進去看到那個頻道的訊息、新訊息即時出現，也能用自己的名字發言。 */
export class TextRooms extends TownFeature {
    /** 誰正在看哪個文字頻道（讀得到、面板開著），key 是 sessionId。新訊息只送給這些人。 */
    private reading = new Map<string, string>();
    /** 每位成員上次發言的時間，key 是帳號 ID。 */
    private lastSayAt = new Map<string, number>();
    private stopWatching: () => void;

    constructor(town: Town) {
        super(town);
        // 新訊息送給正在看那個頻道的人（讀得到才算；語音頻道的文字聊天不會送）
        this.stopWatching = platform().onMessage(town.guildId, (channelId, message) => {
            for (const [sessionId, reading] of this.reading) {
                if (reading === channelId) this.town.clientOf(sessionId)?.send("textMessage", { channelId, message });
            }
        });
    }

    messages(): Record<string, MessageHandler> {
        return { say: (client, text) => void this.say(client, text) };
    }

    /** 進文字房時把那個頻道的訊息送給他；離開時讓前端收起訊息面板。 */
    onRoomChanged(client: Client, room: ChannelRoom | undefined, before: string | undefined) {
        this.reading.delete(client.sessionId);
        if (room?.kind === "text") void this.open(client, room);
        else if (before !== undefined) client.send("textRoom", null);
    }

    onLeave(client: Client) {
        this.reading.delete(client.sessionId);
    }

    dispose() {
        this.stopWatching();
    }

    /** 把文字頻道最新的訊息送給剛走進文字房的人；讀不到時送原因，面板顯示說明而不是空白。 */
    private async open(client: Client, room: ChannelRoom) {
        const send = (messages: unknown[], notice: string | null) =>
            client.send("textRoom", { channelId: room.id, name: room.name, messages, notice });
        const stillHere = () => this.town.roomOf(client.sessionId)?.id === room.id;
        try {
            const messages = await platform().recentMessages(client.auth.guildId, room.id, client.auth.id);
            if (!stillHere()) return;
            this.reading.set(client.sessionId, room.id);
            send(messages, null);
        } catch (e) {
            if (!stillHere()) return;
            if (e instanceof TextRefused) send([], e.message);
            else if (e instanceof PlatformUnavailable) send([], "暫時連不上 Discord，讀不到這個頻道的訊息");
            else {
                console.error("讀文字頻道失敗", e);
                send([], "讀不到這個頻道的訊息，請稍後再試");
            }
        }
    }

    /** 在文字房裡發言：以成員的名字與頭像發到那個文字頻道。發出去的訊息會經 onMessage 回到面板上。 */
    private async say(client: Client, text: unknown) {
        const tell = (message: string) => client.send("textResult", { ok: false, message });
        const room = this.town.roomOf(client.sessionId);
        if (room?.kind !== "text") return tell("要站在文字房裡才能發言");
        const message = typeof text === "string" ? text.trim() : "";
        if (!message) return tell("訊息不能是空的");
        if (message.length > MAX_MESSAGE_LENGTH) return tell(`訊息最多 ${MAX_MESSAGE_LENGTH} 字`);
        const now = this.town.clock.currentTime;
        const last = this.lastSayAt.get(client.auth.id);
        if (last !== undefined && now - last < SAY_INTERVAL_MS) return tell("發太快了，等一下再發");
        this.lastSayAt.set(client.auth.id, now);

        try {
            await platform().sendAs(client.auth.guildId, room.id, client.auth.id, client.auth.name, message);
        } catch (e) {
            if (e instanceof TextRefused) tell(e.message);
            else if (e instanceof PlatformUnavailable) tell("暫時連不上 Discord，訊息沒發出去");
            else {
                console.error("在文字頻道發言失敗", e);
                tell("訊息沒發出去，請稍後再試");
            }
        }
    }
}
