import { MoveRefused, TextRefused, type Platform, type TownMessage, type VoiceMember } from "../src/platform/platform.js";
import type { TownChannel } from "../src/town/layoutTown.js";

/** 測試用的平台：頻道清單由測試決定，也能手動觸發「頻道變動」。沒設定的伺服器當作 bot 沒加入。 */
export function createFakePlatform() {
    const channels = new Map<string, TownChannel[]>();
    const listeners = new Map<string, Set<() => void>>();
    const voice = new Map<string, VoiceMember[]>();
    const voiceListeners = new Map<string, Set<() => void>>();
    /** 收到的搬人要求，給測試檢查。 */
    const moves: { guildId: string; userId: string; channelId: string }[] = [];
    /** 發到通知頻道的訊息，給測試檢查。 */
    const announcements: { guildId: string; text: string; channelId?: string }[] = [];
    /** 開過的一對一通話頻道，給測試檢查。 */
    const calls: { guildId: string; userIds: string[]; name: string; channelId: string }[] = [];
    /** 當作管理員的帳號 ID，測試直接加。 */
    const admins = new Set<string>();
    const messages = new Map<string, TownMessage[]>(); // key 是頻道 ID
    const messageListeners = new Map<string, Set<(channelId: string, message: TownMessage) => void>>();
    const deleteListeners = new Map<string, Set<(channelId: string, messageId: string) => void>>();
    const speakingListeners = new Map<string, Set<(userId: string, speaking: boolean) => void>>();
    /** 用成員身分發出的訊息，給測試檢查。 */
    const sent: { guildId: string; channelId: string; userId: string; name: string; text: string }[] = [];
    let textRefusal: string | undefined;
    let refuseMoves = false;

    const platform: Platform = {
        async channels(guildId) {
            return channels.get(guildId) ?? null;
        },
        onChannelsChanged(guildId, listener) {
            if (!listeners.has(guildId)) listeners.set(guildId, new Set());
            listeners.get(guildId)!.add(listener);
            return () => listeners.get(guildId)!.delete(listener);
        },
        async voiceMembers(guildId) {
            return voice.get(guildId) ?? [];
        },
        onVoiceChanged(guildId, listener) {
            if (!voiceListeners.has(guildId)) voiceListeners.set(guildId, new Set());
            voiceListeners.get(guildId)!.add(listener);
            return () => voiceListeners.get(guildId)!.delete(listener);
        },
        async moveToVoice(guildId, userId, channelId) {
            moves.push({ guildId, userId, channelId });
            if (refuseMoves) throw new MoveRefused("bot 沒有權限把你搬過去");
            const member = voice.get(guildId)?.find((m) => m.userId === userId);
            if (!member) return "not-in-voice";
            if (member.channelId === channelId) return "already-there";
            member.channelId = channelId;
            return "moved";
        },
        async announce(guildId, text, channelId) {
            announcements.push({ guildId, text, ...(channelId && { channelId }) });
        },
        async createPrivateCall(guildId, userIds, name) {
            if (refuseMoves) throw new MoveRefused("bot 沒有「管理頻道」權限");
            const channelId = `call-${calls.length + 1}`;
            calls.push({ guildId, userIds, name, channelId });
            return channelId;
        },
        async isAdmin(_guildId, userId) {
            return admins.has(userId);
        },
        async recentMessages(_guildId, channelId, _userId) {
            if (textRefusal) throw new TextRefused(textRefusal);
            return messages.get(channelId) ?? [];
        },
        onMessage(guildId, listener) {
            if (!messageListeners.has(guildId)) messageListeners.set(guildId, new Set());
            messageListeners.get(guildId)!.add(listener);
            return () => messageListeners.get(guildId)!.delete(listener);
        },
        onSpeaking(guildId, listener) {
            if (!speakingListeners.has(guildId)) speakingListeners.set(guildId, new Set());
            speakingListeners.get(guildId)!.add(listener);
            return () => speakingListeners.get(guildId)!.delete(listener);
        },
        onMessageDeleted(guildId, listener) {
            if (!deleteListeners.has(guildId)) deleteListeners.set(guildId, new Set());
            deleteListeners.get(guildId)!.add(listener);
            return () => deleteListeners.get(guildId)!.delete(listener);
        },
        async sendAs(guildId, channelId, userId, name, text) {
            if (textRefusal) throw new TextRefused(textRefusal);
            sent.push({ guildId, channelId, userId, name, text });
        },
    };

    return {
        platform,
        moves,
        announcements,
        admins,
        calls,
        sent,
        /** 之後讀訊息、發言都當作被拒絕（例如沒打開 Message Content），原因是 reason；給 undefined 恢復。 */
        setTextRefusal(reason: string | undefined) {
            textRefusal = reason;
        },
        setMessages(channelId: string, list: TownMessage[]) {
            messages.set(channelId, list);
        },
        /** 模擬 Discord 送來新訊息的事件。 */
        emitMessage(guildId: string, channelId: string, message: TownMessage) {
            for (const listener of messageListeners.get(guildId) ?? []) listener(channelId, message);
        },
        /** 模擬有人開始或停止講話。 */
        emitSpeaking(guildId: string, userId: string, speaking: boolean) {
            for (const listener of speakingListeners.get(guildId) ?? []) listener(userId, speaking);
        },
        /** 模擬 Discord 送來訊息被刪除的事件。 */
        emitMessageDeleted(guildId: string, channelId: string, messageId: string) {
            for (const listener of deleteListeners.get(guildId) ?? []) listener(channelId, messageId);
        },
        /** 之後的搬人要求都當作 bot 權限不夠。 */
        setRefuseMoves(value: boolean) {
            refuseMoves = value;
        },
        setChannels(guildId: string, list: TownChannel[] | null) {
            if (list) channels.set(guildId, list);
            else channels.delete(guildId);
        },
        /** 模擬 Discord 送來頻道變動的事件。 */
        emitChange(guildId: string) {
            for (const listener of listeners.get(guildId) ?? []) listener();
        },
        /** 設定語音頻道裡的人，並模擬 Discord 送來語音狀態變動的事件。 */
        setVoice(guildId: string, members: VoiceMember[]) {
            voice.set(guildId, members);
            for (const listener of voiceListeners.get(guildId) ?? []) listener();
        },
    };
}
