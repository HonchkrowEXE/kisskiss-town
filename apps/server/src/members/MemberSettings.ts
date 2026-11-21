import type { DatabaseSync } from "node:sqlite";
import type { ChipOwner } from "../chips/ChipLedger.js";

/** 成員自己的設定，每座小鎮各存各的。目前只有「可被搧」。 */
export class MemberSettings {
    constructor(private db: DatabaseSync) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS member_settings (
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                slappable INTEGER NOT NULL DEFAULT 1,
                PRIMARY KEY (guild_id, user_id)
            );
        `);
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
