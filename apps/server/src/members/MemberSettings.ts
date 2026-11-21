import type { DatabaseSync } from "node:sqlite";
import type { ChipOwner } from "../chips/ChipLedger.js";
import { DEFAULT_APPEARANCE, parseAppearance, type Appearance } from "../town/appearance.js";

/** 成員自己的設定，每座小鎮各存各的：「可被搧」、角色外觀。 */
export class MemberSettings {
    constructor(private db: DatabaseSync) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS member_settings (
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                slappable INTEGER NOT NULL DEFAULT 1,
                PRIMARY KEY (guild_id, user_id)
            );
            CREATE TABLE IF NOT EXISTS member_looks (
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                look_json TEXT NOT NULL,
                PRIMARY KEY (guild_id, user_id)
            );
        `);
    }

    /** 角色外觀；沒設定過（或存的部件已經不存在）用預設。 */
    appearance(member: ChipOwner): Appearance {
        const row = this.db
            .prepare("SELECT look_json FROM member_looks WHERE guild_id = ? AND user_id = ?")
            .get(member.guildId, member.userId) as { look_json: string } | undefined;
        return (row && parseAppearance(JSON.parse(row.look_json))) || DEFAULT_APPEARANCE;
    }

    setAppearance(member: ChipOwner, look: Appearance) {
        this.db
            .prepare(
                `INSERT INTO member_looks (guild_id, user_id, look_json) VALUES (?, ?, ?)
                 ON CONFLICT (guild_id, user_id) DO UPDATE SET look_json = excluded.look_json`,
            )
            .run(member.guildId, member.userId, JSON.stringify(look));
    }

    /** 沒設定過的人預設可被搧。 */
    slappable(member: ChipOwner): boolean {
        const row = this.db
            .prepare("SELECT slappable FROM member_settings WHERE guild_id = ? AND user_id = ?")
            .get(member.guildId, member.userId) as { slappable: number } | undefined;
        return row ? row.slappable === 1 : true;
    }

    setSlappable(member: ChipOwner, value: boolean) {
        this.db
            .prepare(
                `INSERT INTO member_settings (guild_id, user_id, slappable) VALUES (?, ?, ?)
                 ON CONFLICT (guild_id, user_id) DO UPDATE SET slappable = excluded.slappable`,
            )
            .run(member.guildId, member.userId, value ? 1 : 0);
    }
}
