import { EventEmitter } from "node:events";
import type { DatabaseSync } from "node:sqlite";
import type { StoredMap } from "./importMap.js";
import type { TablePlacement } from "./tables.js";
import type { BoardPost, TownObject } from "./objects.js";

/** 自訂地圖換了（匯入或改回自動）時通知正在開的小鎮重畫。 */
const mapEvents = new EventEmitter();

/** 訂閱某座小鎮的地圖變動，回傳取消訂閱的函式。 */
export function onCustomMapChanged(guildId: string, listener: () => void) {
    mapEvents.on(guildId, listener);
    return (): void => {
        mapEvents.off(guildId, listener);
    };
}

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
            CREATE TABLE IF NOT EXISTS town_maps (
                guild_id TEXT PRIMARY KEY,
                map_json TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS town_objects (
                guild_id TEXT PRIMARY KEY,
                objects_json TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS town_boards (
                guild_id TEXT NOT NULL,
                object_id TEXT NOT NULL,
                posts_json TEXT NOT NULL,
                PRIMARY KEY (guild_id, object_id)
            );
        `);
    }

    /** 管理員用編輯器擺好的家具；還沒擺過是 undefined（用預設的家具）。 */
    objects(guildId: string): TownObject[] | undefined {
        const row = this.db.prepare("SELECT objects_json FROM town_objects WHERE guild_id = ?").get(guildId) as { objects_json: string } | undefined;
        return row ? (JSON.parse(row.objects_json) as TownObject[]) : undefined;
    }

    /** 給 undefined 就改回預設家具。 */
    setObjects(guildId: string, objects: TownObject[] | undefined) {
        if (!objects) {
            this.db.prepare("DELETE FROM town_objects WHERE guild_id = ?").run(guildId);
            return;
        }
        this.db
            .prepare(
                `INSERT INTO town_objects (guild_id, objects_json) VALUES (?, ?)
                 ON CONFLICT (guild_id) DO UPDATE SET objects_json = excluded.objects_json`,
            )
            .run(guildId, JSON.stringify(objects));
    }

    /** 某台電腦的揪團看板。 */
    board(guildId: string, objectId: string): BoardPost[] {
        const row = this.db.prepare("SELECT posts_json FROM town_boards WHERE guild_id = ? AND object_id = ?").get(guildId, objectId) as
            | { posts_json: string }
            | undefined;
        return row ? (JSON.parse(row.posts_json) as BoardPost[]) : [];
    }

    setBoard(guildId: string, objectId: string, posts: BoardPost[]) {
        this.db
            .prepare(
                `INSERT INTO town_boards (guild_id, object_id, posts_json) VALUES (?, ?, ?)
                 ON CONFLICT (guild_id, object_id) DO UPDATE SET posts_json = excluded.posts_json`,
            )
            .run(guildId, objectId, JSON.stringify(posts));
    }

    /** 管理員匯入的自訂地圖；沒有是 undefined（用自動長出來的小鎮）。 */
    customMap(guildId: string): StoredMap | undefined {
        const row = this.db.prepare("SELECT map_json FROM town_maps WHERE guild_id = ?").get(guildId) as { map_json: string } | undefined;
        return row ? (JSON.parse(row.map_json) as StoredMap) : undefined;
    }

    /** 存自訂地圖（給 undefined 改回自動），並通知正在開的小鎮重畫。 */
    setCustomMap(guildId: string, map: StoredMap | undefined) {
        if (map) {
            this.db
                .prepare(
                    `INSERT INTO town_maps (guild_id, map_json) VALUES (?, ?)
                     ON CONFLICT (guild_id) DO UPDATE SET map_json = excluded.map_json`,
                )
                .run(guildId, JSON.stringify(map));
        } else {
            this.db.prepare("DELETE FROM town_maps WHERE guild_id = ?").run(guildId);
        }
        mapEvents.emit(guildId);
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
