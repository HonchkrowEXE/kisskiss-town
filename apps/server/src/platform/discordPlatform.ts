import { ChannelType, Client, Events, GatewayIntentBits, PermissionFlagsBits } from "discord.js";
import type { TownChannel } from "../town/layoutTown.js";
import { MoveRefused, PlatformUnavailable, type Platform, type VoiceMember } from "./platform.js";

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

/** 語音狀態需要的欄位，跟 discord.js 脫鉤，方便測試。 */
export type RawVoiceState = {
    userId: string;
    displayName: string | null;
    channelId: string | null;
    selfMute: boolean | null;
    serverMute: boolean | null;
    selfDeaf: boolean | null;
    serverDeaf: boolean | null;
    streaming: boolean | null;
};

/** 換成小鎮用的語音成員；不在任何語音頻道的略過。 */
export function toVoiceMembers(states: RawVoiceState[]): VoiceMember[] {
    return states
        .filter((s): s is RawVoiceState & { channelId: string } => s.channelId !== null)
        .map((s) => ({
            userId: s.userId,
            name: s.displayName ?? "（沒有名字）",
            channelId: s.channelId,
            muted: Boolean(s.selfMute || s.serverMute),
            deafened: Boolean(s.selfDeaf || s.serverDeaf),
            streaming: Boolean(s.streaming),
        }));
}

const KIND: Partial<Record<ChannelType, TownChannel["kind"]>> = {
    [ChannelType.GuildText]: "text",
    [ChannelType.GuildAnnouncement]: "text",
    [ChannelType.GuildVoice]: "voice",
    [ChannelType.GuildStageVoice]: "voice",
};

const CHANNEL_EVENTS = [Events.ChannelCreate, Events.ChannelDelete, Events.ChannelUpdate];

/** bot 連上 Discord 最多等多久；連不上就當作暫時讀不到，不要讓進小鎮卡住。 */
const READY_TIMEOUT_MS = 10_000;

export function createDiscordPlatform(token: string | undefined): Platform {
    if (!token) {
        console.warn("沒有設定 DISCORD_BOT_TOKEN：小鎮不會顯示頻道房間");
        return {
            channels: async () => {
                throw new PlatformUnavailable("伺服器沒有設定 DISCORD_BOT_TOKEN");
            },
            onChannelsChanged: () => () => {},
            voiceMembers: async () => {
                throw new PlatformUnavailable("伺服器沒有設定 DISCORD_BOT_TOKEN");
            },
            onVoiceChanged: () => () => {},
            moveToVoice: async () => {
                throw new PlatformUnavailable("伺服器沒有設定 DISCORD_BOT_TOKEN");
            },
        };
    }

    const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
    const ready = new Promise<void>((resolve, reject) => {
        client.once(Events.ClientReady, () => resolve());
        client.login(token).catch((e) => {
            console.error("bot 登入失敗", e);
            reject(new PlatformUnavailable("bot 登入失敗"));
        });
    });
    ready.catch(() => {}); // 失敗的原因在 channels() 裡回報；這裡只是避免沒人接的錯誤讓程式結束

    function waitReady() {
        let timer: ReturnType<typeof setTimeout>;
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new PlatformUnavailable("bot 還沒連上 Discord")), READY_TIMEOUT_MS);
        });
        return Promise.race([ready, timeout]).finally(() => clearTimeout(timer));
    }

    return {
        async channels(guildId) {
            await waitReady();
            const guild = client.guilds.cache.get(guildId);
            if (!guild) return null;
            // ponytail: 全伺服器共用一份地圖，所以只看 @everyone 的檢視權限：私人頻道不會出現，
            // 只開放給特定身分組的頻道也不會出現。要每個人看到自己的版本，得改成每人一份房間清單。
            const everyone = guild.roles.everyone;
            const raw: RawChannel[] = [];
            for (const channel of guild.channels.cache.values()) {
                const kind = KIND[channel.type];
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
            // 身分組權限變了（例如 @everyone 不能再看某個分類），看得到的頻道也會變
            const onRole = (role: { guild: { id: string } }) => role.guild.id === guildId && listener();
            for (const event of CHANNEL_EVENTS) client.on(event as string, onChannel);
            client.on(Events.GuildCreate, onGuild);
            client.on(Events.GuildDelete, onGuild);
            client.on(Events.GuildRoleUpdate, onRole);
            return () => {
                for (const event of CHANNEL_EVENTS) client.off(event as string, onChannel);
                client.off(Events.GuildCreate, onGuild);
                client.off(Events.GuildDelete, onGuild);
                client.off(Events.GuildRoleUpdate, onRole);
            };
        },

        async voiceMembers(guildId) {
            await waitReady();
            const guild = client.guilds.cache.get(guildId);
            if (!guild) return [];
            return toVoiceMembers(
                [...guild.voiceStates.cache.values()]
                    .filter((v) => v.id !== client.user?.id) // bot 自己不畫
                    .map((v) => ({
                    userId: v.id,
                    // ponytail: 名字只在語音狀態變動時更新；改暱稱要等 GUILD_MEMBERS（特權權限）才收得到
                    displayName: v.member?.displayName ?? client.users.cache.get(v.id)?.displayName ?? null,
                    channelId: v.channelId,
                    selfMute: v.selfMute,
                    serverMute: v.serverMute,
                    selfDeaf: v.selfDeaf,
                    serverDeaf: v.serverDeaf,
                    streaming: v.streaming,
                })),
            );
        },

        onVoiceChanged(guildId, listener) {
            const onVoice = (_old: unknown, state: { guild: { id: string } }) => state.guild.id === guildId && listener();
            client.on(Events.VoiceStateUpdate, onVoice);
            return () => client.off(Events.VoiceStateUpdate, onVoice);
        },


        async moveToVoice(guildId, userId, channelId) {
            await waitReady();
            const guild = client.guilds.cache.get(guildId);
            if (!guild) throw new PlatformUnavailable("bot 不在這個伺服器");
            const voice = guild.voiceStates.cache.get(userId);
            if (!voice?.channelId) return "not-in-voice";
            if (voice.channelId === channelId) return "already-there";
            try {
                await guild.members.edit(userId, { channel: channelId });
                return "moved";
            } catch (e) {
                // 錯誤碼見 https://discord.com/developers/docs/topics/opcodes-and-status-codes
                const code = (e as { code?: number }).code;
                if (code === 40032) return "not-in-voice"; // 快取還沒更新，人剛好離開語音
                if (code === 50013 || code === 50001) {
                    throw new MoveRefused("bot 沒有權限把你搬過去，請管理員給 bot「移動成員」和這個頻道的「連接」權限");
                }
                if (code === 10003) throw new MoveRefused("這個語音頻道已經不存在了");
                throw e;
            }
        },
    };
}
