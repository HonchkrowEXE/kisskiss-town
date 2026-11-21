import assert from "assert";
import type { ColyseusTestServer } from "@colyseus/testing";
import { JWT } from "colyseus";
import type appConfig from "../src/app.config.js";
import { testServer, fakePlatform } from "./testServer.js";
import type { TownRoom } from "../src/rooms/TownRoom.js";

const GUILD_A = "9000000000000000001";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const inVoice = (...ids: string[]) =>
    fakePlatform.setVoice(GUILD_A, ids.map((userId) => ({ userId, name: userId, channelId: "c0", muted: false, deafened: false, streaming: false })));

describe("一對一通話", () => {
    let colyseus: ColyseusTestServer<typeof appConfig>;

    before(async () => (colyseus = await testServer()));
    beforeEach(async () => {
        await colyseus.cleanup();
        fakePlatform.calls.length = 0;
        fakePlatform.moves.length = 0;
    });
    afterEach(() => {
        fakePlatform.setVoice(GUILD_A, []);
        fakePlatform.setRefuseMoves(false);
    });

    let nextId = 10000;
    async function enter(name: string) {
        const user = { id: `${nextId++}`, name, guildId: GUILD_A };
        colyseus.sdk.auth.token = await JWT.sign(user);
        const client = await colyseus.sdk.joinOrCreate("town", { guildId: GUILD_A });
        const server = colyseus.getRoomById(client.roomId) as unknown as TownRoom;
        await server.waitForNextPatch();
        const results: { ok: boolean; message: string }[] = [];
        const invites: { from: string; name: string }[] = [];
        client.onMessage("callResult", (r: { ok: boolean; message: string }) => results.push(r));
        client.onMessage("callInvite", (i: { from: string; name: string }) => invites.push(i));
        const character = server.state.characters.get(client.sessionId)!;
        async function send(type: string, payload: unknown) {
            client.send(type, payload);
            await server.waitForMessage(type);
            await wait(40);
        }
        return { client, server, user, character, results, invites, send };
    }

    /** 兩個人站在廣場上相鄰。 */
    async function pair() {
        const a = await enter("小明");
        const b = await enter("小華");
        const { spawn } = a.server.layout;
        Object.assign(a.character.position, { x: spawn.x, y: spawn.y });
        Object.assign(b.character.position, { x: spawn.x + 16, y: spawn.y });
        return { a, b };
    }

    it("邀請身邊的人；對方接受後開一個只有兩人的語音頻道，把兩個人搬進去", async () => {
        const { a, b } = await pair();
        inVoice(a.user.id, b.user.id);
        await a.send("callInvite", { to: b.client.sessionId });
        assert.deepStrictEqual(b.invites, [{ from: a.client.sessionId, name: "小明" }]);

        await b.send("callAnswer", { from: a.client.sessionId, accept: true });
        assert.deepStrictEqual(fakePlatform.calls.map((c) => [c.userIds, c.name]), [[[a.user.id, b.user.id], "📞 小明 和 小華"]]);
        assert.deepStrictEqual(fakePlatform.moves.map((m) => [m.userId, m.channelId]), [[a.user.id, "call-1"], [b.user.id, "call-1"]]);
        assert.strictEqual(a.results.at(-1)?.ok, true);
        assert.strictEqual(b.results.at(-1)?.ok, true);
    });

    it("對方拒絕時，邀請人收到通知、不開頻道；同一個邀請不能回兩次", async () => {
        const { a, b } = await pair();
        await a.send("callInvite", { to: b.client.sessionId });
        await b.send("callAnswer", { from: a.client.sessionId, accept: false });
        assert.deepStrictEqual(a.results.at(-1), { ok: false, message: "小華 現在不方便通話" });
        await b.send("callAnswer", { from: a.client.sessionId, accept: true });
        assert.deepStrictEqual(b.results.at(-1), { ok: false, message: "這個邀請已經失效了" });
        assert.strictEqual(fakePlatform.calls.length, 0);
    });

    it("離太遠、打給自己、連發邀請都被擋", async () => {
        const { a, b } = await pair();
        b.character.position.x += 80;
        await a.send("callInvite", { to: b.client.sessionId });
        assert.deepStrictEqual(a.results.at(-1), { ok: false, message: "要走近一點才能邀請" });
        await a.send("callInvite", { to: a.client.sessionId });
        assert.deepStrictEqual(a.results.at(-1), { ok: false, message: "找不到這個人" });

        b.character.position.x -= 80;
        await a.send("callInvite", { to: b.client.sessionId });
        await a.send("callInvite", { to: b.client.sessionId });
        assert.deepStrictEqual(a.results.at(-1), { ok: false, message: "剛邀請過，等一下再試" });
    });

    it("有人不在語音裡時說明要先加入語音，不開頻道", async () => {
        const { a, b } = await pair();
        inVoice(a.user.id);
        await a.send("callInvite", { to: b.client.sessionId });
        await b.send("callAnswer", { from: a.client.sessionId, accept: true });
        assert.match(b.results.at(-1)!.message, /小華 要先在 Discord 加入/);
        assert.strictEqual(fakePlatform.calls.length, 0);
    });

    it("bot 權限不夠時兩個人都看得到原因", async () => {
        const { a, b } = await pair();
        inVoice(a.user.id, b.user.id);
        fakePlatform.setRefuseMoves(true);
        await a.send("callInvite", { to: b.client.sessionId });
        await b.send("callAnswer", { from: a.client.sessionId, accept: true });
        assert.deepStrictEqual(a.results.at(-1), { ok: false, message: "bot 沒有「管理頻道」權限" });
    });
});
