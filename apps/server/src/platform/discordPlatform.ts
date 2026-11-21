import { ChannelType, Client, Events, GatewayIntentBits, PermissionFlagsBits } from "discord.js";
import type { TownChannel } from "../town/layoutTown.js";
import type { Platform } from "./platform.js";

/** 排序需要的頻道欄位，跟 discord.js 脫鉤，方便測試。 */
export type RawChannel = TownChannel & {
    position: number;
    /** 所屬分類的位置；沒有分類是 null。 */
    categoryPosition: number | null;
};

/**
 * 照 Discord 側邊欄的順序排：沒有分類的頻道在最上面，接著依分類順序；
 * 同一個分類裡文字頻道在語音頻道上面，再依各自的位置。
 */
export function orderChannels(channels: RawChannel[]): TownChannel[] {
    const kindOrder = { text: 0, voice: 1 };
    return [...channels]
        .sort(
            (a, b) =>
                (a.categoryPosition ?? -1) - (b.categoryPosition ?? -1) ||
                kindOrder[a.kind] - kindOrder[b.kind] ||
                a.position - b.position ||
                a.id.localeCompare(b.id),
        )
        .map(({ id, name, kind }) => ({ id, name, kind }));
}

const KIND: Partial<Record<ChannelType, TownChannel["kind"]>> = {
    [ChannelType.GuildText]: "text",
    [ChannelType.GuildAnnouncement]: "text",
    [ChannelType.GuildVoice]: "voice",
    [ChannelType.GuildStageVoice]: "voice",
};

const CHANNEL_EVENTS = [Events.ChannelCreate, Events.ChannelDelete, Events.ChannelUpdate];

export function createDiscordPlatform(token: string | undefined): Platform {
    if (!token) {
        console.warn("沒有設定 DISCORD_BOT_TOKEN：小鎮不會顯示頻道房間");
        return { channels: async () => null, onChannelsChanged: () => () => {} };
    }

    const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
    const ready = new Promise<void>((resolve) => client.once(Events.ClientReady, () => resolve()));
    client.login(token).catch((e) => console.error("bot 登入失敗", e));

    return {
        async channels(guildId) {
            await ready;
            const guild = client.guilds.cache.get(guildId);
            if (!guild) return null;
            const everyone = guild.roles.everyone;
            const raw: RawChannel[] = [];
            for (const channel of guild.channels.cache.values()) {
                const kind = KIND[channel.type];
                // 只放所有人都看得到的頻道，私人頻道的名稱不會出現在小鎮上
                if (!kind || !channel.permissionsFor(everyone)?.has(PermissionFlagsBits.ViewChannel)) continue;
                raw.push({
                    id: channel.id,
                    name: channel.name,
                    kind,
                    position: "position" in channel ? channel.position : 0,
                    categoryPosition: channel.parent?.position ?? null,
                });
            }
            return orderChannels(raw);
        },

        onChannelsChanged(guildId, listener) {
            // 改名時 discord.js 傳 (舊, 新)，兩個的 guildId 一樣，看第一個就好
            const onChannel = (channel: { guildId?: string }) => channel.guildId === guildId && listener();
            const onGuild = (guild: { id: string }) => guild.id === guildId && listener();
            for (const event of CHANNEL_EVENTS) client.on(event as string, onChannel);
            client.on(Events.GuildCreate, onGuild);
            client.on(Events.GuildDelete, onGuild);
            return () => {
                for (const event of CHANNEL_EVENTS) client.off(event as string, onChannel);
                client.off(Events.GuildCreate, onGuild);
                client.off(Events.GuildDelete, onGuild);
            };
        },
    };
}
