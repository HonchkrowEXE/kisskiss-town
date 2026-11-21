import type { DatabaseSync } from "node:sqlite";

// 籌碼是純虛擬的：只能從這裡列出的方式取得，沒有任何付費或兌現的方法（ADR-0005）。
// 只有遊戲伺服器能改籌碼，每一筆變動都記帳。

export const WELCOME_CHIPS = 1000;
export const CHECKIN_CHIPS = 200;
export const RELIEF_CHIPS = 500;

/** 變動原因：發放、簽到、救濟、下注、結算。 */
export type ChipReason = "welcome" | "checkin" | "relief" | "bet" | "payout";

/** 籌碼以「哪座小鎮的哪位成員」為單位，每座小鎮各算各的。 */
export type ChipOwner = { guildId: string; userId: string };

export type ChipEntry = { reason: ChipReason; delta: number; balance: number; at: string };

/** 規則不允許的操作（例如重複簽到、餘額不夠）。訊息可以直接顯示給成員看。 */
export class ChipError extends Error {}

/** 台北時間的日期，例如 "2026-11-21"。 */
const taipeiDate = (now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(now);

export class ChipLedger {
    constructor(private db: DatabaseSync) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS chip_accounts (
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                balance INTEGER NOT NULL CHECK (balance >= 0),
                last_checkin TEXT,
                relief_claimed INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (guild_id, user_id)
            );
            CREATE TABLE IF NOT EXISTS chip_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                reason TEXT NOT NULL,
                delta INTEGER NOT NULL,
                balance INTEGER NOT NULL,
                at TEXT NOT NULL
            );
        `);
    }

    balance(owner: ChipOwner): number {
        return this.account(owner)?.balance ?? 0;
    }

    /** 第一次進小鎮送 WELCOME_CHIPS，之後再呼叫不會重複發。回傳餘額。 */
    welcome(owner: ChipOwner): number {
        if (this.account(owner)) return this.balance(owner);
        this.db
            .prepare("INSERT INTO chip_accounts (guild_id, user_id, balance) VALUES (?, ?, 0)")
            .run(owner.guildId, owner.userId);
        return this.record(owner, WELCOME_CHIPS, "welcome");
    }

    /** 每天簽到一次（以台北時間換日）。回傳餘額。 */
    checkIn(owner: ChipOwner, now = new Date()): number {
        const account = this.mustHaveAccount(owner);
        const today = taipeiDate(now);
        if (account.last_checkin === today) throw new ChipError("今天已經簽到過了");
        return this.transaction(() => {
            this.db
                .prepare("UPDATE chip_accounts SET last_checkin = ? WHERE guild_id = ? AND user_id = ?")
                .run(today, owner.guildId, owner.userId);
            return this.record(owner, CHECKIN_CHIPS, "checkin");
        });
    }

    /** 餘額歸零時可以領一次救濟金，一輩子只能領一次。回傳餘額。 */
    claimRelief(owner: ChipOwner): number {
        const account = this.mustHaveAccount(owner);
        if (account.relief_claimed) throw new ChipError("救濟金已經領過了");
        if (account.balance > 0) throw new ChipError("籌碼歸零才能領救濟金");
        return this.transaction(() => {
            this.db
                .prepare("UPDATE chip_accounts SET relief_claimed = 1 WHERE guild_id = ? AND user_id = ?")
                .run(owner.guildId, owner.userId);
            return this.record(owner, RELIEF_CHIPS, "relief");
        });
    }

    /** 遊戲下注（負數）或結算（正數）。餘額不夠時拒絕。回傳餘額。 */
    change(owner: ChipOwner, delta: number, reason: "bet" | "payout"): number {
        if (!Number.isInteger(delta)) throw new ChipError("籌碼必須是整數");
        const account = this.mustHaveAccount(owner);
        if (account.balance + delta < 0) throw new ChipError("籌碼不夠");
        return this.transaction(() => this.record(owner, delta, reason));
    }

    history(owner: ChipOwner): ChipEntry[] {
        return this.db
            .prepare("SELECT reason, delta, balance, at FROM chip_entries WHERE guild_id = ? AND user_id = ? ORDER BY id")
            .all(owner.guildId, owner.userId) as ChipEntry[];
    }

    private account(owner: ChipOwner) {
        return this.db
            .prepare("SELECT balance, last_checkin, relief_claimed FROM chip_accounts WHERE guild_id = ? AND user_id = ?")
            .get(owner.guildId, owner.userId) as
            | { balance: number; last_checkin: string | null; relief_claimed: number }
            | undefined;
    }

    private mustHaveAccount(owner: ChipOwner) {
        const account = this.account(owner);
        if (!account) throw new ChipError("還沒進過這座小鎮");
        return account;
    }

    /** 改餘額並記一筆帳，兩件事一定一起發生。回傳變動後的餘額。 */
    private record(owner: ChipOwner, delta: number, reason: ChipReason): number {
        return this.transaction(() => {
            const { balance } = this.db
                .prepare("UPDATE chip_accounts SET balance = balance + ? WHERE guild_id = ? AND user_id = ? RETURNING balance")
                .get(delta, owner.guildId, owner.userId) as { balance: number };
            this.db
                .prepare("INSERT INTO chip_entries (guild_id, user_id, reason, delta, balance, at) VALUES (?, ?, ?, ?, ?, ?)")
                .run(owner.guildId, owner.userId, reason, delta, balance, new Date().toISOString());
            return balance;
        });
    }

    /** 包成一個交易；已經在交易裡就直接執行（巢狀呼叫時）。 */
    private transaction<T>(fn: () => T): T {
        if (this.db.isTransaction) return fn();
        this.db.exec("BEGIN");
        try {
            const result = fn();
            this.db.exec("COMMIT");
            return result;
        } catch (e) {
            this.db.exec("ROLLBACK");
            throw e;
        }
    }
}
