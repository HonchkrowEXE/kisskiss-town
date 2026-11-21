import assert from "assert";
import type { ColyseusTestServer } from "@colyseus/testing";
import type appConfig from "../src/app.config.js";
import { testServer } from "./testServer.js";

const GUILD_ID = "9000000000000000001";

describe("/discord_token 路由", () => {
    let colyseus: ColyseusTestServer<typeof appConfig>;
    const original = process.env.ALLOW_MOCK_LOGIN;

    before(async () => (colyseus = await testServer()));
    beforeEach(async () => colyseus.cleanup());
    // 原本沒設時要刪掉；直接指定 undefined 會變成字串 "undefined"
    afterEach(() => {
        if (original === undefined) delete process.env.ALLOW_MOCK_LOGIN;
        else process.env.ALLOW_MOCK_LOGIN = original;
    });

    const post = (body: object) => colyseus.http.post("/discord_token", { body });

    it("沒打開 ALLOW_MOCK_LOGIN 時，假登入被拒", async () => {
        process.env.ALLOW_MOCK_LOGIN = "false";

        await assert.rejects(post({ code: "mock_code", guildId: GUILD_ID }), (e: any) => e.statusCode === 400);
    });

    it("打開 ALLOW_MOCK_LOGIN 時，假登入拿到的 token 能進小鎮", async () => {
        process.env.ALLOW_MOCK_LOGIN = "true";

        const { data } = await post({ code: "mock_code", guildId: GUILD_ID });
        colyseus.sdk.auth.token = data.token;
        const room = await colyseus.sdk.joinOrCreate("town", { guildId: GUILD_ID });

        assert.strictEqual(data.user.guildId, GUILD_ID);
        assert.ok(room.roomId);
    });

    it("缺少 guildId 時回 400", async () => {
        process.env.ALLOW_MOCK_LOGIN = "true";

        await assert.rejects(post({ code: "mock_code" }), (e: any) => e.statusCode === 400);
    });
});
