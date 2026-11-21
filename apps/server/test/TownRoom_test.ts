import assert from "assert";
import type { ColyseusTestServer } from "@colyseus/testing";
import { JWT } from "colyseus";
import type appConfig from "../src/app.config.js";
import { testServer, fakePlatform, DEFAULT_TEST_CHANNELS } from "./testServer.js";
import type { TownRoom } from "../src/rooms/TownRoom.js";
import type { TownMapState } from "../src/town/layoutTown.js";
import { createWalkable } from "../src/town/walkable.js";

const GUILD_A = "9000000000000000001";
const GUILD_B = "9000000000000000002";

describe("小鎮房間", () => {
    let colyseus: ColyseusTestServer<typeof appConfig>;

    before(async () => (colyseus = await testServer()));
    beforeEach(async () => colyseus.cleanup());

    /** 用某個成員的身分（登入時簽好的 JWT）進入某座小鎮。 */
    async function join(user: { id: string; name: string; guildId: string }, guildId = user.guildId) {
        colyseus.sdk.auth.token = await JWT.sign(user);
        return colyseus.sdk.joinOrCreate("town", { guildId });
    }

    const xiaoming = { id: "1", name: "鎮長小明", guildId: GUILD_A };
    const xiaohua = { id: "2", name: "小華", guildId: GUILD_A };
    const outsider = { id: "3", name: "外人", guildId: GUILD_B };

    it("同一個伺服器的成員進到同一座小鎮（不管在哪個頻道開）", async () => {
        const a = await join(xiaoming);
        const b = await join(xiaohua);

        assert.strictEqual(a.roomId, b.roomId);
    });

    it("不同伺服器的小鎮彼此隔離", async () => {
        const a = await join(xiaoming);
        const c = await join(outsider);

        assert.notStrictEqual(a.roomId, c.roomId);
    });

    it("拿 A 伺服器的登入，不能進 B 伺服器的小鎮", async () => {
        await assert.rejects(join(xiaoming, GUILD_B));
    });

    it("token 過期或亂填時被拒，狀態碼是 401（不是會被 Cloudflare 換掉的 523）", async () => {
        for (const token of [await JWT.sign(xiaoming, { expiresIn: -10 }), "not-a-jwt"]) {
            colyseus.sdk.auth.token = token;
            await assert.rejects(colyseus.sdk.joinOrCreate("town", { guildId: GUILD_A }), (e: any) => e.code === 401);
        }
    });

    it("伺服器設定有問題（例如 JWT_SECRET 沒設）時不偽裝成 401", async () => {
        const verify = JWT.verify;
        (JWT as any).verify = async () => {
            throw Object.assign(new Error("secret or public key must be provided"), { name: "JsonWebTokenError" });
        };
        try {
            colyseus.sdk.auth.token = "anything";
            await assert.rejects(colyseus.sdk.joinOrCreate("town", { guildId: GUILD_A }), (e: any) => e.code !== 401);
        } finally {
            (JWT as any).verify = verify;
        }
    });

    it("小鎮裡顯示登入時取得的名字", async () => {
        const a = await join(xiaoming);
        await colyseus.getRoomById(a.roomId).waitForNextPatch();

        assert.strictEqual(a.state.characters.get(a.sessionId).name, "鎮長小明");
    });

    it("一座小鎮可以超過 4 個人", async () => {
        const rooms = [];
        for (let i = 0; i < 5; i++) rooms.push(await join({ id: `${i}`, name: `成員${i}`, guildId: GUILD_A }));

        assert.strictEqual(new Set(rooms.map((r) => r.roomId)).size, 1);
    });

    it("成員離開後，其他人那邊的角色消失", async () => {
        const a = await join(xiaoming);
        const b = await join(xiaohua);
        const server = colyseus.getRoomById(a.roomId);
        await server.waitForNextPatch();
        assert.ok(a.state.characters.get(b.sessionId));

        await b.leave();
        await server.waitForNextPatch();

        assert.strictEqual(a.state.characters.get(b.sessionId), undefined);
    });
});

describe("走動", () => {
    let colyseus: ColyseusTestServer<typeof appConfig>;

    before(async () => (colyseus = await testServer()));
    beforeEach(async () => colyseus.cleanup());

    const AT_CORNER = { x: 24, y: 24, dir: "down" };

    /** 進小鎮，記下伺服器傳回的每一次 moveRejected。 */
    async function enter() {
        colyseus.sdk.auth.token = await JWT.sign({ id: "1", name: "小明", guildId: GUILD_A });
        const client = await colyseus.sdk.joinOrCreate("town", { guildId: GUILD_A });
        const server = colyseus.getRoomById(client.roomId) as unknown as TownRoom;
        const character = server.state.characters.get(client.sessionId);
        const rejections: unknown[] = [];
        client.onMessage("moveRejected", (pos: unknown) => rejections.push(pos));

        /** 送出移動，等伺服器處理完；被拒絕的話回傳伺服器拉回的位置與面向。 */
        async function move(message: unknown) {
            const before = rejections.length;
            client.send("move", message);
            await server.waitForMessage("move");
            await server.waitForNextPatch(); // 讓 moveRejected 也有時間送回前端
            return rejections.length > before ? rejections.at(-1) : undefined;
        }
        return { client, server, character, move };
    }

    /** 進小鎮，並把角色放到 (24, 24)：預設地圖左上角第一格地板的中央，左邊和上面都是牆。 */
    async function enterAtCorner() {
        const room = await enter();
        room.character.position.x = AT_CORNER.x;
        room.character.position.y = AT_CORNER.y;
        return room;
    }

    it("出生在可以站的地方", async () => {
        const { server, character } = await enter();
        const { x, y } = character.position;

        assert.ok(server.walkable.canStand(x, y), `生在 (${x}, ${y})`);
    });

    it("合法的移動被採用，也記下面向", async () => {
        const { character, move } = await enterAtCorner();

        const rejected = await move({ x: 28, y: 24, dir: "right" });

        assert.strictEqual(rejected, undefined);
        assert.deepStrictEqual([character.position.x, character.position.y, character.dir], [28, 24, "right"]);
    });

    it("走進牆裡被拒絕，前端收到原本的位置和面向", async () => {
        const { character, move } = await enterAtCorner();

        const rejected = await move({ x: 19, y: 24, dir: "left" });

        assert.deepStrictEqual(rejected, AT_CORNER);
        assert.deepStrictEqual([character.position.x, character.position.y], [24, 24]);
    });

    it("一次移動太遠（瞬移）被拒絕", async () => {
        const { character, move } = await enterAtCorner();

        const rejected = await move({ x: 248, y: 200, dir: "right" });

        assert.deepStrictEqual(rejected, AT_CORNER);
        assert.deepStrictEqual([character.position.x, character.position.y], [24, 24]);
    });

    it("不能隔著一格厚的牆跳過去", async () => {
        const { server, character, move } = await enterAtCorner();
        // 換成中間有一道單格牆的小地圖：x 16~32 是牆，兩邊都是地板
        //   地 牆 地
        server.walkable = createWalkable({
            width: 3, height: 1, tilewidth: 16, tileheight: 16,
            layers: [{ type: "tilelayer", data: [1, 2, 1] }],
            tilesets: [{ firstgid: 1, tiles: [{ id: 1, properties: [{ name: "collides", value: true }] }] }],
        });
        character.position.x = 8;
        character.position.y = 8;

        // 8 → 40 共 32px，沒超過移動額度，終點也站得住，但中間是牆
        const rejected = await move({ x: 40, y: 8, dir: "right" });

        assert.deepStrictEqual(rejected, { x: 8, y: 8, dir: "down" });
    });

    it("連發小步也不能超過速度上限", async () => {
        const { client, character } = await enterAtCorner();

        // 一口氣送 20 步、每步 4px（共 80px），遠超過累積的額度
        let x = 24;
        for (let i = 0; i < 20; i++) client.send("move", { x: (x += 4), y: 24, dir: "right" });
        await new Promise((r) => setTimeout(r, 200));

        assert.ok(character.position.x < 24 + 80, `跑到了 x=${character.position.x}`);
    });

    it("格式不對的訊息被拒絕", async () => {
        const { character, move } = await enterAtCorner();

        for (const bad of [{ x: "abc", y: 24, dir: "right" }, { x: 28, y: 24, dir: "fly" }, null]) {
            const rejected = await move(bad);
            assert.deepStrictEqual(rejected, AT_CORNER, JSON.stringify(bad));
        }
        assert.deepStrictEqual([character.position.x, character.position.y, character.dir], [24, 24, "down"]);
    });
});

describe("籌碼", () => {
    let colyseus: ColyseusTestServer<typeof appConfig>;

    before(async () => (colyseus = await testServer()));
    beforeEach(async () => colyseus.cleanup());

    /** 每個測試用不同的成員，資料庫在整個測試程序裡共用。 */
    let nextId = 1000;
    async function enter() {
        const user = { id: `${nextId++}`, name: "小明", guildId: GUILD_A };
        colyseus.sdk.auth.token = await JWT.sign(user);
        const client = await colyseus.sdk.joinOrCreate("town", { guildId: GUILD_A });
        const server = colyseus.getRoomById(client.roomId) as unknown as TownRoom;
        await server.waitForNextPatch();
        const results: { ok: boolean; message: string }[] = [];
        client.onMessage("chipResult", (r: { ok: boolean; message: string }) => results.push(r));
        async function send(type: string) {
            client.send(type);
            await server.waitForMessage(type);
            await server.waitForNextPatch();
            return results.at(-1);
        }
        return { client, server, user, send, chips: () => client.state.characters.get(client.sessionId).chips };
    }

    it("第一次進小鎮看得到 1000 籌碼，離開再進來不會重拿", async () => {
        const { client, user, chips } = await enter();
        assert.strictEqual(chips(), 1000);

        await client.leave();
        colyseus.sdk.auth.token = await JWT.sign(user);
        const again = await colyseus.sdk.joinOrCreate("town", { guildId: GUILD_A });
        await colyseus.getRoomById(again.roomId).waitForNextPatch();
        assert.strictEqual(again.state.characters.get(again.sessionId).chips, 1000);
    });

    it("簽到後餘額更新；同一天再簽被拒並收到原因", async () => {
        const { send, chips } = await enter();

        assert.deepStrictEqual(await send("checkIn"), { ok: true, message: "簽到成功" });
        assert.strictEqual(chips(), 1200);

        assert.deepStrictEqual(await send("checkIn"), { ok: false, message: "今天已經簽到過了" });
        assert.strictEqual(chips(), 1200);
    });

    it("還有籌碼時領救濟金被拒", async () => {
        const { send, chips } = await enter();

        assert.deepStrictEqual(await send("claimRelief"), { ok: false, message: "籌碼歸零才能領救濟金" });
        assert.strictEqual(chips(), 1000);
    });

    it("同一位成員開兩個分頁，簽到後兩邊的餘額都更新", async () => {
        const first = await enter();
        colyseus.sdk.auth.token = await JWT.sign(first.user);
        const second = await colyseus.sdk.joinOrCreate("town", { guildId: GUILD_A });
        await first.server.waitForNextPatch();

        await first.send("checkIn");

        assert.strictEqual(second.state.characters.get(second.sessionId).chips, 1200);
    });
});

describe("小鎮地圖從頻道長出來", () => {
    let colyseus: ColyseusTestServer<typeof appConfig>;

    before(async () => (colyseus = await testServer()));
    beforeEach(async () => colyseus.cleanup());
    afterEach(() => fakePlatform.setChannels(GUILD_A, DEFAULT_TEST_CHANNELS));

    async function enter(guildId = GUILD_A) {
        colyseus.sdk.auth.token = await JWT.sign({ id: "1", name: "小明", guildId });
        const client = await colyseus.sdk.joinOrCreate("town", { guildId });
        const server = colyseus.getRoomById(client.roomId) as unknown as TownRoom;
        await server.waitForNextPatch();
        const map = () => JSON.parse(client.state.map) as TownMapState;
        return { client, server, map };
    }

    it("每個頻道一個房間，前端拿得到房間名稱", async () => {
        const { map } = await enter();

        assert.deepStrictEqual(map().rooms.map((r) => r.name), DEFAULT_TEST_CHANNELS.map((c) => c.name));
        assert.strictEqual(map().botMissing, false);
    });

    it("頻道變動時，在線成員的地圖跟著更新", async () => {
        const { server, map } = await enter();

        fakePlatform.setChannels(GUILD_A, [{ id: "new", name: "新頻道", kind: "voice" }]);
        fakePlatform.emitChange(GUILD_A);
        await server.waitForNextPatch();
        await server.waitForNextPatch();

        assert.deepStrictEqual(map().rooms.map((r) => r.name), ["新頻道"]);
    });

    it("地圖變小時，站在新牆裡的角色被送回廣場", async () => {
        const { client, server } = await enter();
        const character = server.state.characters.get(client.sessionId);
        // 站到第二排房間裡（只有很多頻道時才存在）
        const room = server.layout.rooms[5];
        character.position.x = room.rect.x + 8;
        character.position.y = room.rect.y + 8;

        fakePlatform.setChannels(GUILD_A, []);
        fakePlatform.emitChange(GUILD_A);
        await server.waitForNextPatch();
        await server.waitForNextPatch();

        assert.ok(server.walkable.canStand(character.position.x, character.position.y));
    });

    it("bot 沒加進伺服器時，前端知道要顯示提示", async () => {
        const { map } = await enter(GUILD_B);

        assert.strictEqual(map().botMissing, true);
        assert.deepStrictEqual(map().rooms, []);
    });
});
