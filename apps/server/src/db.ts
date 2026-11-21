import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

/** 預設放在 apps/server/data/（已在 .gitignore），不管從哪個資料夾啟動伺服器都一樣。 */
const DEFAULT_PATH = fileURLToPath(new URL("../data/kisskiss.db", import.meta.url));

let db: DatabaseSync | undefined;

/**
 * 整個伺服器共用一個資料庫連線（ADR-0009）。第一次用到才打開。
 * 位置可以用 KISSKISS_DB 改；測試設成 ":memory:"。
 */
export function database() {
    if (!db) {
        const path = process.env.KISSKISS_DB ?? DEFAULT_PATH;
        if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
        db = new DatabaseSync(path);
    }
    return db;
}
