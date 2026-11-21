import { platform } from "../../platform/platform.js";
import type { Town } from "../Town.js";
import { TownFeature } from "./TownFeature.js";

/** 對話框最多幾個字，太長的截斷。 */
export const BUBBLE_MAX = 60;

/**
 * 頭上的對話框：
 * - 在 Discord 語音頻道的文字聊天打字，小鎮裡那個人頭上顯示這句話（前端顯示 10 秒）。
 *   只看語音房（小鎮上看得到的語音頻道）；文字房的訊息在文字房面板裡看。
 * - 正在講話時顯示「…」（平台支援時；Discord 要打開 DISCORD_VOICE_LISTEN）
 */
export class SpeechBubbles extends TownFeature {
    private stopWatching: (() => void)[];

    constructor(town: Town) {
        super(town);
        this.stopWatching = [
            platform().onMessage(town.guildId, (channelId, message) => {
                const room = this.town.layout.rooms.find((r) => r.id === channelId);
                if (room?.kind !== "voice" || !message.content) return;
                const text = message.content.length > BUBBLE_MAX ? `${message.content.slice(0, BUBBLE_MAX)}…` : message.content;
                this.town.sendToAll("bubble", { userId: message.authorId, text });
            }),
            platform().onSpeaking(town.guildId, (userId, speaking) => this.town.sendToAll("speaking", { userId, speaking })),
        ];
    }

    dispose() {
        for (const stop of this.stopWatching) stop();
    }
}
