import { ChannelType, Client, Events, GatewayIntentBits, PermissionFlagsBits, escapeMarkdown, type Message, type NewsChannel, type TextChannel, type Webhook } from "discord.js";
import type { TownChannel } from "../town/layoutTown.js";
import { MoveRefused, PlatformUnavailable, TextRefused, type Platform, type TownMessage, type VoiceMember } from "./platform.js";

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

/** 文字房一次顯示幾則訊息。 */
const RECENT_MESSAGES = 30;

const NO_MESSAGE_CONTENT =
    "bot 還讀不到訊息內容：管理員要到 Discord Developer Portal 的 Bot 頁打開 Message Content Intent，並在伺服器設定 DISCORD_MESSAGE_CONTENT=true";

/** 訊息只有附件或嵌入內容、沒有文字時，顯示一段說明代替。 */
export function describeMessage(m: { content: string; attachments: number; embeds: number }) {
    if (m.content) return m.content;
    if (m.attachments) return "📎 附件";
    if (m.embeds) return "（嵌入內容）";
    return "";
}

function toTownMessage(m: Message): TownMessage {
    return {
        id: m.id,
        author: m.member?.displayName ?? m.author.displayName,
        content: describeMessage({ content: m.content, attachments: m.attachments.size, embeds: m.embeds.length }),
        at: m.createdTimestamp,
    };
}

/** discord.js 錯誤的錯誤碼，見 https://discord.com/developers/docs/topics/opcodes-and-status-codes */
const codeOf = (e: unknown) => (e as { code?: number }).code;

/** bot 連上 Discord 最多等多久；連不上就當作暫時讀不到，不要讓進小鎮卡住。 */
const READY_TIMEOUT_MS = 10_000;

export function createDiscordPlatform(token: string | undefined, { messageContent = false } = {}): Platform {
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
            announce: async () => {
                throw new PlatformUnavailable("伺服器沒有設定 DISCORD_BOT_TOKEN");
            },
            recentMessages: async () => {
                throw new PlatformUnavailable("伺服器沒有設定 DISCORD_BOT_TOKEN");
            },
            onMessage: () => () => {},
            sendAs: async () => {
                throw new PlatformUnavailable("伺服器沒有設定 DISCORD_BOT_TOKEN");
            },
        };
    }

    // Message Content 是特權 intent：Developer Portal 沒打開卻要求的話，bot 整個登不進去，所以要明確設定才要
    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildVoiceStates,
            GatewayIntentBits.GuildMessages,
            ...(messageContent ? [GatewayIntentBits.MessageContent] : []),
        ],
    });
    /** 每個文字頻道用來代替成員發言的 webhook（bot 自己建的那個）。 */
    const webhooks = new Map<string, Promise<Webhook>>();
    function webhookFor(channel: TextChannel | NewsChannel) {
        let hook = webhooks.get(channel.id);
        if (!hook) {
            const created = channel
                .fetchWebhooks()
                .then((list) => list.find((w) => w.owner?.id === client.user?.id && w.token) ?? channel.createWebhook({ name: "親親小鎮" }));
            created.catch(() => forgetWebhook(channel.id, created)); // 失敗了下次重新找
            webhooks.set(channel.id, (hook = created));
        }
        return hook;
    }
    /** 只在快取裡還是同一個 webhook 時才忘掉，兩個請求同時失敗也只會重建一個。 */
    function forgetWebhook(channelId: string, hook: Promise<Webhook>) {
        if (webhooks.get(channelId) === hook) webhooks.delete(channelId);
    }
    /** 每位成員在有慢速模式的頻道上次發言的時間，key 是「頻道 ID:帳號 ID」。 */
    const lastSent = new Map<string, number>();
    /** 成員現在的資料：直接問 Discord，不用快取（沒有 GUILD_MEMBERS intent，身分組、禁言的變動收不到）。 */
    const freshMember = (channel: TextChannel | NewsChannel, userId: string) =>
        channel.guild.members.fetch({ user: userId, force: true }).catch((): null => null);
    function textChannel(guildId: string, channelId: string) {
        const channel = client.guilds.cache.get(guildId)?.channels.cache.get(channelId);
        if (channel?.type !== ChannelType.GuildText && channel?.type !== ChannelType.GuildAnnouncement) {
            throw new TextRefused("這個文字頻道已經不存在了");
        }
        return channel;
    }
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

        async announce(guildId, text) {
            await waitReady();
            // ponytail: 先發在伺服器設定的「系統訊息頻道」。要讓管理員自己指定頻道，得加斜線指令（bot 要重新邀請、多要 applications.commands）
            const channel = client.guilds.cache.get(guildId)?.systemChannel;
            const me = client.user;
            if (!channel || !me || !channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) return;
            // 名字是成員自己取的，跳脫 Markdown、不解析 @，避免變成格式或 @everyone
            await channel.send({ content: escapeMarkdown(text), allowedMentions: { parse: [] } });
        },

        async recentMessages(guildId, channelId, userId) {
            await waitReady();
            if (!messageContent) throw new TextRefused(NO_MESSAGE_CONTENT);
            const channel = textChannel(guildId, channelId);
            const canRead = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory];
            // bot 沒有讀取訊息歷史的權限時，Discord 回的是空清單而不是錯誤，要先自己檢查
            if (!client.user || !channel.permissionsFor(client.user)?.has(canRead)) {
                throw new TextRefused("bot 沒有讀這個頻道的權限，請管理員給 bot「檢視頻道」和「讀取訊息歷史」");
            }
            const member = await freshMember(channel, userId);
            if (!member || !channel.permissionsFor(member).has(canRead)) throw new TextRefused("你在 Discord 看不到這個頻道的訊息");
            try {
                const list = await channel.messages.fetch({ limit: RECENT_MESSAGES });
                return [...list.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp).map(toTownMessage);
            } catch (e) {
                if (codeOf(e) === 50001 || codeOf(e) === 50013) {
                    throw new TextRefused("bot 沒有讀這個頻道的權限，請管理員給 bot「檢視頻道」和「讀取訊息歷史」");
                }
                throw e;
            }
        },

        onMessage(guildId, listener) {
            const onCreate = (m: Message) => messageContent && m.guildId === guildId && listener(m.channelId, toTownMessage(m));
            client.on(Events.MessageCreate, onCreate);
            return () => client.off(Events.MessageCreate, onCreate);
        },

        async sendAs(guildId, channelId, userId, name, text) {
            await waitReady();
            const channel = textChannel(guildId, channelId);
            const member = await freshMember(channel, userId);
            if (!member) throw new TextRefused("找不到你在這個伺服器的成員資料");
            const avatarURL = member.displayAvatarURL(); // 先拿：下一行的禁言判斷是型別守衛，之後 TS 會把 member 當成 never
            if (member.isCommunicationDisabled()) throw new TextRefused("你在 Discord 被禁言中，暫時不能發言");
            const permissions = channel.permissionsFor(member);
            if (!permissions.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
                throw new TextRefused("你在 Discord 不能在這個頻道發言");
            }
            // 慢速模式：有「管理訊息」或「管理頻道」權限的人不受限（跟 Discord 一樣）
            const slowmode = channel.rateLimitPerUser ?? 0;
            const bypass = permissions.has(PermissionFlagsBits.ManageMessages) || permissions.has(PermissionFlagsBits.ManageChannels);
            const key = `${channelId}:${userId}`;
            if (slowmode && !bypass && Date.now() - (lastSent.get(key) ?? 0) < slowmode * 1000) {
                throw new TextRefused(`這個頻道有慢速模式，每 ${slowmode} 秒才能發一則`);
            }
            // ponytail: webhook 的名字不能含 "discord"、"clyde"，有的話 Discord 會拒絕（50035）；遇到再決定要不要換掉
            const hook = webhookFor(channel);
            const send = async () => (await webhookFor(channel)).send({ content: text, username: name.slice(0, 80), avatarURL, allowedMentions: { parse: [] } });
            try {
                await send().catch((e) => {
                    if (codeOf(e) !== 10015) throw e;
                    forgetWebhook(channelId, hook); // webhook 被人刪掉了：重建一個再發一次
                    return send();
                });
                if (slowmode) lastSent.set(key, Date.now());
            } catch (e) {
                if (codeOf(e) === 50001 || codeOf(e) === 50013) {
                    throw new TextRefused("bot 沒有「管理 Webhook」權限，沒辦法用你的名字發言，請管理員給 bot 這個權限");
                }
                throw e;
            }
        },
    };
}
