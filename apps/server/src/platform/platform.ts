// 平台轉接層（ADR-0008）：遊戲邏輯只透過這裡拿 Discord 的資料。第一版只有 Discord 一種實作。

import type { TownChannel } from "../town/layoutTown.js";
import { createDiscordPlatform } from "./discordPlatform.js";

export type Platform = {
    /** 小鎮要顯示的頻道，照 Discord 的順序；bot 不在這個伺服器裡時回傳 null；暫時連不上 Discord 時丟 PlatformUnavailable。 */
    channels(guildId: string): Promise<TownChannel[] | null>;
    /** 這個伺服器的頻道有變動（新增、刪除、改名、bot 被加入或移除）時呼叫 listener。回傳取消訂閱的函式。 */
    onChannelsChanged(guildId: string, listener: () => void): () => void;
};

/** 暫時讀不到平台的資料（bot 沒設定、登入失敗、還沒連上）。 */
export class PlatformUnavailable extends Error {}

let current: Platform | undefined;

/** 目前使用的平台；第一次用到才建立（才登入 bot）。 */
export function platform(): Platform {
    return (current ??= createDiscordPlatform(process.env.DISCORD_BOT_TOKEN));
}

/** 測試用：換成假的平台。 */
export function usePlatform(fake: Platform) {
    current = fake;
}
