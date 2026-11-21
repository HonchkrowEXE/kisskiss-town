import assert from "assert";
import { loginWithDiscord, LoginError } from "../src/auth/discordLogin.js";

const GUILD_ID = "9000000000000000001";

/** 假的 fetch：依網址回傳預先設定的回應，並記下被呼叫過的網址。 */
function fakeFetch(routes: Record<string, { status: number; body: unknown }>) {
    const calls: string[] = [];
    const fetch = async (input: string | URL | Request) => {
        const url = String(input);
        calls.push(url);
        const route = Object.entries(routes).find(([path]) => url.endsWith(path));
        if (!route) throw new Error(`測試沒有設定這個網址：${url}`);
        const { status, body } = route[1];
        return new Response(JSON.stringify(body), { status });
    };
    return { fetch: fetch as typeof globalThis.fetch, calls };
}

const okToken = { status: 200, body: { access_token: "token-abc" } };
const okMe = {
    status: 200,
    body: { id: "9000000000000000002", username: "xiaoming", global_name: "小明" },
};
const okMember = { status: 200, body: { nick: "鎮長小明" } };

function deps(fetch: typeof globalThis.fetch) {
    return { fetch, clientId: "client-id", clientSecret: "client-secret" };
}

describe("loginWithDiscord", () => {
    it("成員登入成功：回傳伺服器 ID 與伺服器暱稱", async () => {
        const { fetch } = fakeFetch({
            "/oauth2/token": okToken,
            "/users/@me": okMe,
            [`/users/@me/guilds/${GUILD_ID}/member`]: okMember,
        });

        const result = await loginWithDiscord("good-code", GUILD_ID, deps(fetch));

        assert.strictEqual(result.accessToken, "token-abc");
        assert.deepStrictEqual(result.user, {
            id: "9000000000000000002",
            name: "鎮長小明",
            guildId: GUILD_ID,
        });
    });

    it("沒有伺服器暱稱時，用 DC 顯示名稱", async () => {
        const { fetch } = fakeFetch({
            "/oauth2/token": okToken,
            "/users/@me": okMe,
            [`/users/@me/guilds/${GUILD_ID}/member`]: { status: 200, body: { nick: null } },
        });

        const result = await loginWithDiscord("good-code", GUILD_ID, deps(fetch));

        assert.strictEqual(result.user.name, "小明");
    });

    it("DC 拒絕授權碼時丟出錯誤", async () => {
        const { fetch } = fakeFetch({
            "/oauth2/token": { status: 400, body: { error: "invalid_grant" } },
        });

        await assert.rejects(loginWithDiscord("bad-code", GUILD_ID, deps(fetch)));
    });

    it("不是該伺服器成員時丟出錯誤", async () => {
        const { fetch } = fakeFetch({
            "/oauth2/token": okToken,
            "/users/@me": okMe,
            [`/users/@me/guilds/${GUILD_ID}/member`]: { status: 404, body: { message: "Unknown Guild" } },
        });

        await assert.rejects(loginWithDiscord("good-code", GUILD_ID, deps(fetch)));
    });

    it("沒有伺服器 ID（私訊裡開啟）時丟出錯誤，且不呼叫 DC", async () => {
        const { fetch, calls } = fakeFetch({});

        await assert.rejects(loginWithDiscord("good-code", "", deps(fetch)));
        assert.strictEqual(calls.length, 0);
    });
});

describe("loginWithDiscord：DC 回應不完整", () => {
    it("換 token 回 200 卻沒有 access_token 時丟出錯誤，且不再往下呼叫", async () => {
        const { fetch, calls } = fakeFetch({ "/oauth2/token": { status: 200, body: {} } });

        await assert.rejects(loginWithDiscord("good-code", GUILD_ID, deps(fetch)), LoginError);
        assert.deepStrictEqual(calls.map((u) => new URL(u).pathname), ["/api/oauth2/token"]);
    });
});
