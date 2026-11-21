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

    const post = (body: object, headers: Record<string, string> = {}) =>
        colyseus.http.post("/discord_token", { body, headers });

    /** 經 cloudflared 通道進來的請求，Cloudflare 會加上 cf-ray 標頭。 */
    const TUNNELED = { "cf-ray": "8f00000000000000-TPE" };

    it("沒打開 ALLOW_MOCK_LOGIN 時，假登入被拒", async () => {
        process.env.ALLOW_MOCK_LOGIN = "false";

        await assert.rejects(post({ code: "mock_code", guildId: GUILD_ID }), (e: any) => e.statusCode === 403);
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

    it("經通道進來的假登入一律被拒，就算打開了 ALLOW_MOCK_LOGIN", async () => {
        process.env.ALLOW_MOCK_LOGIN = "true";

        await assert.rejects(post({ code: "mock_code", guildId: GUILD_ID }, TUNNELED), (e: any) => e.statusCode === 403);
    });

    it("發出的小鎮 token 有到期時間", async () => {
        process.env.ALLOW_MOCK_LOGIN = "true";

        const { data } = await post({ code: "mock_code", guildId: GUILD_ID });
        const payload = JSON.parse(Buffer.from(data.token.split(".")[1], "base64url").toString());

        assert.ok(payload.exp > payload.iat, JSON.stringify(payload));
    });

    it("伺服器沒設定 Client ID／Secret 時回 500，並說明原因", async () => {
        const saved = process.env.DISCORD_CLIENT_SECRET;
        delete process.env.DISCORD_CLIENT_SECRET;
        try {
            await assert.rejects(post({ code: "real-code", guildId: GUILD_ID }), (e: any) =>
                e.statusCode === 500 && /DISCORD_CLIENT_SECRET/.test(e.data?.error));
        } finally {
            if (saved !== undefined) process.env.DISCORD_CLIENT_SECRET = saved;
        }
    });
});
