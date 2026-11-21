// 平台轉接層（ADR-0008）：遊戲邏輯只透過這裡拿 Discord 的資料。第一版只有 Discord 一種實作。

import type { TownChannel } from "../town/layoutTown.js";
import { createDiscordPlatform } from "./discordPlatform.js";

export type Platform = {
    /** 小鎮要顯示的頻道，照 Discord 的順序；bot 不在這個伺服器裡時回傳 null；暫時連不上 Discord 時丟 PlatformUnavailable。 */
    channels(guildId: string): Promise<TownChannel[] | null>;
    /** 這個伺服器的頻道有變動（新增、刪除、改名、bot 被加入或移除）時呼叫 listener。回傳取消訂閱的函式。 */
    onChannelsChanged(guildId: string, listener: () => void): () => void;
    /** 現在在這個伺服器語音頻道裡的成員；bot 不在伺服器裡時是空陣列；暫時連不上時丟 PlatformUnavailable。 */
    voiceMembers(guildId: string): Promise<VoiceMember[]>;
    /** 有人加入、離開、換語音頻道，或靜音、拒聽、直播狀態改變時呼叫 listener。回傳取消訂閱的函式。 */
    onVoiceChanged(guildId: string, listener: () => void): () => void;
    /**
     * 把成員搬到某個語音頻道。成員不在任何語音頻道時回傳 "not-in-voice"（平台不能把人拉進語音）。
     * bot 權限不夠時丟 MoveRefused；暫時連不上時丟 PlatformUnavailable。
     */
    moveToVoice(guildId: string, userId: string, channelId: string): Promise<"moved" | "already-there" | "not-in-voice">;
    /** 在伺服器的通知頻道發一則純文字訊息（不 @ 任何人）；沒有能發的頻道就不發。暫時連不上時丟 PlatformUnavailable。 */
    announce(guildId: string, text: string, channelId?: string): Promise<void>;
    /** 這位成員是不是管理員（有「管理伺服器」權限）。每次都問平台，不用快取。暫時連不上時丟 PlatformUnavailable。 */
    isAdmin(guildId: string, userId: string): Promise<boolean>;
    /**
     * 文字頻道最新的訊息，舊的在前。成員本人在 Discord 也要看得到這個頻道。
     * 讀不到時丟 TextRefused（原因可以給成員看）；暫時連不上時丟 PlatformUnavailable。
     */
    recentMessages(guildId: string, channelId: string, userId: string): Promise<TownMessage[]>;
    /** 這個伺服器的文字頻道有新訊息時呼叫 listener。讀不到訊息內容時不呼叫。回傳取消訂閱的函式。 */
    onMessage(guildId: string, listener: (channelId: string, message: TownMessage) => void): () => void;
    /** 這個伺服器的文字頻道有訊息被刪掉時呼叫 listener（例如管理員刪掉洗版）。回傳取消訂閱的函式。 */
    onMessageDeleted(guildId: string, listener: (channelId: string, messageId: string) => void): () => void;
    /**
     * 以成員的名字與頭像在文字頻道發言（不 @ 任何人）。遵守成員在 Discord 的限制：不能發言的頻道、禁言、慢速模式。
     * 發不出去時丟 TextRefused；暫時連不上時丟 PlatformUnavailable。
     */
    sendAs(guildId: string, channelId: string, userId: string, name: string, text: string): Promise<void>;
};

/** 文字頻道裡的一則訊息。 */
export type TownMessage = { id: string; author: string; authorId: string; content: string; at: number };

/** 讀不到或發不出文字頻道的訊息（例如 bot 權限不夠、沒打開 Message Content）。訊息可以直接顯示給成員看。 */
export class TextRefused extends Error {}

/** 平台拒絕搬人，例如 bot 缺少「移動成員」或「連接」權限。訊息可以直接顯示給成員看。 */
export class MoveRefused extends Error {}

/** 在語音頻道裡的一位成員。 */
export type VoiceMember = {
    userId: string;
    name: string;
    channelId: string;
    /** 自己靜音或被伺服器靜音。 */
    muted: boolean;
    /** 自己拒聽或被伺服器拒聽。 */
    deafened: boolean;
    streaming: boolean;
};

/** 暫時讀不到平台的資料（bot 沒設定、登入失敗、還沒連上）。 */
export class PlatformUnavailable extends Error {}

let current: Platform | undefined;

/** 目前使用的平台；第一次用到才建立（才登入 bot）。 */
export function platform(): Platform {
    return (current ??= createDiscordPlatform(process.env.DISCORD_BOT_TOKEN, {
        messageContent: process.env.DISCORD_MESSAGE_CONTENT === "true",
    }));
}

/** 測試用：換成假的平台。 */
export function usePlatform(fake: Platform) {
    current = fake;
}
