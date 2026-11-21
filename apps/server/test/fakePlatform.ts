import type { Platform } from "../src/platform/platform.js";
import type { TownChannel } from "../src/town/layoutTown.js";

/** 測試用的平台：頻道清單由測試決定，也能手動觸發「頻道變動」。沒設定的伺服器當作 bot 沒加入。 */
export function createFakePlatform() {
    const channels = new Map<string, TownChannel[]>();
    const listeners = new Map<string, Set<() => void>>();

    const platform: Platform = {
        async channels(guildId) {
            return channels.get(guildId) ?? null;
        },
        onChannelsChanged(guildId, listener) {
            if (!listeners.has(guildId)) listeners.set(guildId, new Set());
            listeners.get(guildId)!.add(listener);
            return () => listeners.get(guildId)!.delete(listener);
        },
    };

    return {
        platform,
        setChannels(guildId: string, list: TownChannel[] | null) {
            if (list) channels.set(guildId, list);
            else channels.delete(guildId);
        },
        /** 模擬 Discord 送來頻道變動的事件。 */
        emitChange(guildId: string) {
            for (const listener of listeners.get(guildId) ?? []) listener();
        },
    };
}
