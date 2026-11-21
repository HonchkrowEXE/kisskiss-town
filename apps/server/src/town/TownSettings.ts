import type { DatabaseSync } from "node:sqlite";

/** 每座小鎮由管理員決定的設定。目前只有搧巴掌通知發在哪個文字頻道。 */
export class TownSettings {
    constructor(private db: DatabaseSync) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS town_settings (
                guild_id TEXT PRIMARY KEY,
                notify_channel_id TEXT
            );
        `);
    }

    /** 通知要發的頻道 ID；沒設定是 undefined（發在伺服器的系統訊息頻道）。 */
    notifyChannel(guildId: string): string | undefined {
        const row = this.db.prepare("SELECT notify_channel_id FROM town_settings WHERE guild_id = ?").get(guildId) as
            | { notify_channel_id: string | null }
            | undefined;
        return row?.notify_channel_id ?? undefined;
    }

    /** 給 undefined 就改回系統訊息頻道。 */
    setNotifyChannel(guildId: string, channelId: string | undefined) {
        this.db
            .prepare(
                `INSERT INTO town_settings (guild_id, notify_channel_id) VALUES (?, ?)
                 ON CONFLICT (guild_id) DO UPDATE SET notify_channel_id = excluded.notify_channel_id`,
            )
            .run(guildId, channelId ?? null);
    }
}
