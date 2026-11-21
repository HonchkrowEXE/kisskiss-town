import type { DatabaseSync } from "node:sqlite";
import type { TablePlacement } from "./tables.js";

/** 每座小鎮由管理員決定的設定：搧巴掌通知發在哪個文字頻道、遊戲桌擺在哪。 */
export class TownSettings {
    constructor(private db: DatabaseSync) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS town_settings (
                guild_id TEXT PRIMARY KEY,
                notify_channel_id TEXT
            );
            CREATE TABLE IF NOT EXISTS town_tables (
                guild_id TEXT PRIMARY KEY,
                tables_json TEXT NOT NULL
            );
        `);
    }

    /** 管理員擺好的遊戲桌；還沒擺過是 undefined（用預設的桌子）。 */
    tables(guildId: string): TablePlacement[] | undefined {
        const row = this.db.prepare("SELECT tables_json FROM town_tables WHERE guild_id = ?").get(guildId) as { tables_json: string } | undefined;
        return row ? (JSON.parse(row.tables_json) as TablePlacement[]) : undefined;
    }

    setTables(guildId: string, tables: TablePlacement[]) {
        this.db
            .prepare(
                `INSERT INTO town_tables (guild_id, tables_json) VALUES (?, ?)
                 ON CONFLICT (guild_id) DO UPDATE SET tables_json = excluded.tables_json`,
            )
            .run(guildId, JSON.stringify(tables));
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
