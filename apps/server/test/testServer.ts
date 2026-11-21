import { ColyseusTestServer, boot } from "@colyseus/testing";
import appConfig from "../src/app.config.js";
import { usePlatform } from "../src/platform/platform.js";
import { createFakePlatform } from "./fakePlatform.js";

// 同一個 mocha 程序裡 boot() 第二次，伺服器會壞（ERR_HTTP_HEADERS_SENT），
// 所以所有測試檔共用一台。不用 shutdown：mocha 有 --exit，跑完會直接結束。
// 測試用記憶體裡的資料庫，不碰本機的 data/kisskiss.db（資料庫第一次用到才打開，這時已經設好了）
process.env.KISSKISS_DB = ":memory:";

/** 測試不連 Discord：頻道清單由測試決定。預設給測試伺服器 8 個頻道，地圖夠大可以走動。 */
export const fakePlatform = createFakePlatform();
usePlatform(fakePlatform.platform);
export const DEFAULT_TEST_CHANNELS = Array.from({ length: 8 }, (_, i) => ({
    id: `c${i}`,
    name: `頻道${i}`,
    kind: (i % 2 ? "text" : "voice") as "text" | "voice",
}));
fakePlatform.setChannels("9000000000000000001", DEFAULT_TEST_CHANNELS);

let server: Promise<ColyseusTestServer<typeof appConfig>>;
export const testServer = () => (server ??= boot(appConfig));
