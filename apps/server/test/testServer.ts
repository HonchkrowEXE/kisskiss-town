import { ColyseusTestServer, boot } from "@colyseus/testing";
import appConfig from "../src/app.config.js";

// 同一個 mocha 程序裡 boot() 第二次，伺服器會壞（ERR_HTTP_HEADERS_SENT），
// 所以所有測試檔共用一台。不用 shutdown：mocha 有 --exit，跑完會直接結束。
let server: Promise<ColyseusTestServer<typeof appConfig>>;
export const testServer = () => (server ??= boot(appConfig));
