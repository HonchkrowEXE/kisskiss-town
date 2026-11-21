import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

let db: DatabaseSync | undefined;

/**
 * 整個伺服器共用一個資料庫連線（ADR-0009）。第一次用到才打開。
 * 位置由 KISSKISS_DB 決定，預設 data/kisskiss.db；測試設成 ":memory:"。
 */
export function database() {
    if (!db) {
        const path = process.env.KISSKISS_DB ?? "data/kisskiss.db";
        if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
        db = new DatabaseSync(path);
    }
    return db;
}
