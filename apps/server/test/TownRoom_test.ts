import assert from "assert";
import type { ColyseusTestServer } from "@colyseus/testing";
import { JWT } from "colyseus";
import type appConfig from "../src/app.config.js";
import { testServer, fakePlatform, DEFAULT_TEST_CHANNELS } from "./testServer.js";
import type { TownRoom } from "../src/rooms/TownRoom.js";
import type { TownMapState } from "../src/town/layoutTown.js";
import { PlatformUnavailable } from "../src/platform/platform.js";
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
        assert.strictEqual(map().notice, null);
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

    it("頻道事件連續來時，晚回來的舊結果不會蓋掉新的", async () => {
        const { server, map } = await enter();
        const channels = fakePlatform.platform.channels;
        let call = 0;
        fakePlatform.platform.channels = async () => {
            call++;
            if (call === 1) {
                await new Promise((r) => setTimeout(r, 100));
                return [{ id: "old", name: "舊的", kind: "voice" }];
            }
            return [{ id: "new", name: "新的", kind: "voice" }];
        };
        try {
            await Promise.all([server.refreshLayout(GUILD_A), server.refreshLayout(GUILD_A)]);
            await server.waitForNextPatch();
        } finally {
            fakePlatform.platform.channels = channels;
        }

        assert.deepStrictEqual(map().rooms.map((r) => r.name), ["新的"]);
    });

    it("暫時讀不到 Discord 時，小鎮照樣進得去並顯示提示", async () => {
        const channels = fakePlatform.platform.channels;
        fakePlatform.platform.channels = async () => {
            throw new PlatformUnavailable("bot 登入失敗");
        };
        try {
            const { map } = await enter();
            assert.match(map().notice ?? "", /暫時讀不到/);
            assert.deepStrictEqual(map().rooms, []);
        } finally {
            fakePlatform.platform.channels = channels;
        }
    });

    it("bot 沒加進伺服器時，前端收到請管理員邀請的提示", async () => {
        const { map } = await enter(GUILD_B);

        assert.match(map().notice ?? "", /邀請/);
        assert.deepStrictEqual(map().rooms, []);
    });
});

describe("語音頻道裡的人站在房間裡", () => {
    let colyseus: ColyseusTestServer<typeof appConfig>;

    before(async () => (colyseus = await testServer()));
    beforeEach(async () => colyseus.cleanup());
    afterEach(() => fakePlatform.setVoice(GUILD_A, []));

    const voice = (userId: string, channelId: string, over: object = {}) => ({
        userId, name: `成員${userId}`, channelId, muted: false, deafened: false, streaming: false, ...over,
    });

    async function enter() {
        colyseus.sdk.auth.token = await JWT.sign({ id: "me", name: "小明", guildId: GUILD_A });
        const client = await colyseus.sdk.joinOrCreate("town", { guildId: GUILD_A });
        const server = colyseus.getRoomById(client.roomId) as unknown as TownRoom;
        await server.waitForNextPatch();
        return { client, server };
    }

    /** 等伺服器處理完語音變動並同步給前端。 */
    async function settle(server: TownRoom) {
        await new Promise((r) => setTimeout(r, 20));
        await server.waitForNextPatch();
    }

    it("一進小鎮就看到已經在語音頻道裡的人，站在對應房間裡", async () => {
        fakePlatform.setVoice(GUILD_A, [voice("1", "c0"), voice("2", "c2", { muted: true })]);
        const { client, server } = await enter();

        const figure = client.state.voice.get("2");
        const room = server.layout.rooms.find((r) => r.id === "c2")!;
        assert.strictEqual(figure.name, "成員2");
        assert.strictEqual(figure.muted, true);
        assert.ok(figure.x >= room.rect.x && figure.x <= room.rect.x + room.rect.width);
        assert.strictEqual(client.state.voice.size, 2);
    });

    it("有人加入、換頻道、開直播、離開時即時更新", async () => {
        const { client, server } = await enter();

        fakePlatform.setVoice(GUILD_A, [voice("1", "c0")]);
        await settle(server);
        assert.strictEqual(client.state.voice.get("1").channelId, "c0");

        fakePlatform.setVoice(GUILD_A, [voice("1", "c2", { streaming: true })]);
        await settle(server);
        assert.strictEqual(client.state.voice.get("1").channelId, "c2");
        assert.strictEqual(client.state.voice.get("1").streaming, true);

        fakePlatform.setVoice(GUILD_A, []);
        await settle(server);
        assert.strictEqual(client.state.voice.size, 0);
    });

    it("暫時連不上 Discord 時，語音房裡的人保持原樣不會消失", async () => {
        fakePlatform.setVoice(GUILD_A, [voice("1", "c0")]);
        const { client, server } = await enter();
        const voiceMembers = fakePlatform.platform.voiceMembers;
        fakePlatform.platform.voiceMembers = async () => {
            throw new PlatformUnavailable("斷線");
        };
        try {
            await server.refreshVoice(GUILD_A);
            await server.waitForNextPatch();
        } finally {
            fakePlatform.platform.voiceMembers = voiceMembers;
        }

        assert.strictEqual(client.state.voice.size, 1);
    });

    it("頻道不在地圖上的人不顯示", async () => {
        fakePlatform.setVoice(GUILD_A, [voice("1", "private-channel")]);
        const { client } = await enter();

        assert.strictEqual(client.state.voice.size, 0);
    });

    it("角色帶著帳號 ID，前端才對得上他的語音狀態", async () => {
        const { client } = await enter();

        assert.strictEqual(client.state.characters.get(client.sessionId).userId, "me");
    });
});

describe("走進語音房就搬頻道", () => {
    let colyseus: ColyseusTestServer<typeof appConfig>;

    before(async () => (colyseus = await testServer()));
    beforeEach(async () => {
        await colyseus.cleanup();
        fakePlatform.moves.length = 0;
    });
    afterEach(() => {
        fakePlatform.setVoice(GUILD_A, []);
        fakePlatform.setRefuseMoves(false);
    });

    /** 進小鎮，站到某個房間門外的廣場或走廊上；回傳一個走進那個房間的函式。 */
    async function standOutside(roomIndex: number) {
        colyseus.sdk.auth.token = await JWT.sign({ id: "me", name: "小明", guildId: GUILD_A });
        const client = await colyseus.sdk.joinOrCreate("town", { guildId: GUILD_A });
        const server = colyseus.getRoomById(client.roomId) as unknown as TownRoom;
        await server.waitForNextPatch();
        const room = server.layout.rooms[roomIndex];
        const character = server.state.characters.get(client.sessionId);
        const doorX = room.rect.x + room.rect.width / 2;
        character.position.x = doorX;
        character.position.y = room.rect.y - 24; // 門外一格（牆的上面）
        const results: { ok: boolean; message: string }[] = [];
        client.onMessage("voiceMove", (r: { ok: boolean; message: string }) => results.push(r));

        /** 往下走一步（每步 16px，不超過移動額度）。 */
        async function stepDown() {
            client.send("move", { x: doorX, y: character.position.y + 16, dir: "down" });
            await server.waitForMessage("move");
            // 等移動額度回復（每秒 80px），下一步才不會因為超速被拒絕
            await new Promise((r) => setTimeout(r, 220));
        }
        return { client, server, room, results, enter: async () => { await stepDown(); await stepDown(); } , stepDown };
    }

    it("已經在語音裡的人走進語音房，會被搬到那個頻道", async () => {
        fakePlatform.setVoice(GUILD_A, [{ userId: "me", name: "小明", channelId: "c2", muted: false, deafened: false, streaming: false }]);
        const { room, results, enter } = await standOutside(0); // c0 是語音房

        await enter();

        assert.deepStrictEqual(fakePlatform.moves, [{ guildId: GUILD_A, userId: "me", channelId: room.id }]);
        assert.deepStrictEqual(results.at(-1), { ok: true, message: `已切到語音頻道「${room.name}」` });
    });

    it("走進文字房不會搬", async () => {
        fakePlatform.setVoice(GUILD_A, [{ userId: "me", name: "小明", channelId: "c0", muted: false, deafened: false, streaming: false }]);
        const { enter } = await standOutside(1); // c1 是文字房

        await enter();

        assert.deepStrictEqual(fakePlatform.moves, []);
    });

    it("在同一個語音房裡走來走去，只搬一次", async () => {
        fakePlatform.setVoice(GUILD_A, [{ userId: "me", name: "小明", channelId: "c2", muted: false, deafened: false, streaming: false }]);
        const { server, client, enter, stepDown } = await standOutside(0);

        await enter();
        await stepDown();
        const { y } = server.state.characters.get(client.sessionId).position;
        assert.ok(y > server.layout.rooms[0].rect.y + 16, `第三步沒走成，停在 y=${y}`);

        assert.strictEqual(fakePlatform.moves.length, 1);
    });

    it("不在任何語音頻道時，提示要先加入語音", async () => {
        const { results, enter } = await standOutside(0);

        await enter();

        assert.strictEqual(results.at(-1)?.ok, false);
        assert.match(results.at(-1)!.message, /先在 Discord 加入/);
    });

    it("搬的途中又走進別的語音房：不排一長串請求，搬完直接去最後那間", async () => {
        const { server, client, results } = await standOutside(0);
        const calls: string[] = [];
        const moveToVoice = fakePlatform.platform.moveToVoice;
        fakePlatform.platform.moveToVoice = async (_g, _u, channelId) => {
            calls.push(channelId);
            await new Promise((r) => setTimeout(r, 50));
            return "moved";
        };
        try {
            const [a, b, c] = [server.layout.rooms[0], server.layout.rooms[2], server.layout.rooms[4]];
            const serverClient = server.clients.find((x) => x.sessionId === client.sessionId)!;
            const moving = (server as any).moveIntoVoice(serverClient, a);
            (server as any).moveIntoVoice(serverClient, b);
            (server as any).moveIntoVoice(serverClient, c);
            await moving;
            await new Promise((r) => setTimeout(r, 20));

            assert.deepStrictEqual(calls, [a.id, c.id]);
            assert.deepStrictEqual(results.map((r) => r.message), [`已切到語音頻道「${c.name}」`]);
        } finally {
            fakePlatform.platform.moveToVoice = moveToVoice;
        }
    });

    it("頻道重新排序後原本就站在語音房裡的人，不會因為下一步被搬", async () => {
        fakePlatform.setVoice(GUILD_A, [{ userId: "me", name: "小明", channelId: "c1", muted: false, deafened: false, streaming: false }]);
        const { server, client, room } = await standOutside(1); // c1 文字房；先站進去
        const character = server.state.characters.get(client.sessionId);
        character.position.y = room.rect.y + 8;
        // 把 c1 改成語音頻道：同一個位置變成語音房
        fakePlatform.setChannels(GUILD_A, DEFAULT_TEST_CHANNELS.map((c) => (c.id === "c1" ? { ...c, kind: "voice" as const } : c)));
        await server.refreshLayout(GUILD_A);

        client.send("move", { x: character.position.x, y: character.position.y + 4, dir: "down" });
        await server.waitForMessage("move");
        await new Promise((r) => setTimeout(r, 20));

        assert.deepStrictEqual(fakePlatform.moves, []);
        fakePlatform.setChannels(GUILD_A, DEFAULT_TEST_CHANNELS);
    });

    it("bot 權限不夠時，成員看得到原因", async () => {
        fakePlatform.setVoice(GUILD_A, [{ userId: "me", name: "小明", channelId: "c2", muted: false, deafened: false, streaming: false }]);
        fakePlatform.setRefuseMoves(true);
        const { results, enter } = await standOutside(0);

        await enter();

        assert.deepStrictEqual(results.at(-1), { ok: false, message: "bot 沒有權限把你搬過去" });
    });
});

describe("搧巴掌", () => {
    let colyseus: ColyseusTestServer<typeof appConfig>;

    before(async () => (colyseus = await testServer()));
    beforeEach(async () => {
        await colyseus.cleanup();
        fakePlatform.announcements.length = 0;
    });

    /** 每個測試用不同的成員，資料庫（可被搧的設定）在整個測試程序裡共用。 */
    let nextId = 2000;
    async function enter(name: string) {
        const user = { id: `${nextId++}`, name, guildId: GUILD_A };
        colyseus.sdk.auth.token = await JWT.sign(user);
        const client = await colyseus.sdk.joinOrCreate("town", { guildId: GUILD_A });
        const server = colyseus.getRoomById(client.roomId) as unknown as TownRoom;
        await server.waitForNextPatch();
        const results: { ok: boolean; message: string }[] = [];
        client.onMessage("slapResult", (r: { ok: boolean; message: string }) => results.push(r));
        const slapped: { x: number; y: number }[] = [];
        client.onMessage("slapped", (p: { x: number; y: number }) => slapped.push(p));
        const character = server.state.characters.get(client.sessionId);
        /** 送出搧巴掌，回傳伺服器回的結果。 */
        async function slap() {
            client.send("slap");
            await server.waitForMessage("slap");
            await server.waitForNextPatch();
            return results.at(-1);
        }
        return { client, server, user, character, slap, slapped };
    }

    /** 兩個人在廣場上左右相鄰：a 在左、b 在右一格。 */
    async function neighbours() {
        const a = await enter("小明");
        const b = await enter("小華");
        const { spawn } = a.server.layout;
        Object.assign(a.character.position, { x: spawn.x, y: spawn.y });
        Object.assign(b.character.position, { x: spawn.x + 16, y: spawn.y });
        a.character.dir = "right";
        return { a, b, spawn };
    }

    it("搧旁邊的人：對方往後退一格、前端被拉到新位置，Discord 收到通知", async () => {
        const { a, b, spawn } = await neighbours();

        assert.deepStrictEqual(await a.slap(), { ok: true, message: "啪！你搧了 小華" });
        assert.deepStrictEqual([b.character.position.x, b.character.position.y], [spawn.x + 32, spawn.y]);
        await new Promise((r) => setTimeout(r, 20));
        assert.deepStrictEqual(b.slapped.at(-1), { x: spawn.x + 32, y: spawn.y, dir: "down" });
        assert.deepStrictEqual(fakePlatform.announcements, [{ guildId: GUILD_A, text: "👋 小明 在親親小鎮搧了 小華 一巴掌！" }]);
    });

    it("旁邊沒人時搧不到，也不發通知", async () => {
        const { a, b } = await neighbours();
        b.character.position.x += 40;

        assert.deepStrictEqual(await a.slap(), { ok: false, message: "旁邊沒有人可以搧" });
        assert.deepStrictEqual(fakePlatform.announcements, []);
    });

    it("10 秒內再搧被擋，並告訴還要等幾秒", async () => {
        const { a, b } = await neighbours();
        await a.slap();
        b.character.position.x = a.character.position.x + 16;

        const result = await a.slap();
        assert.strictEqual(result?.ok, false);
        assert.match(result!.message, /冷卻中，還要 10 秒/);
    });

    it("關掉「可被搧」的人搧不到，搧的人看到提示；重新進小鎮設定還在", async () => {
        const { a, b } = await neighbours();
        b.client.send("setSlappable", false);
        await b.server.waitForMessage("setSlappable");

        assert.deepStrictEqual(await a.slap(), { ok: false, message: "小華 關掉了「可被搧」" });

        await b.client.leave();
        colyseus.sdk.auth.token = await JWT.sign(b.user);
        const again = await colyseus.sdk.joinOrCreate("town", { guildId: GUILD_A });
        await b.server.waitForNextPatch();
        assert.strictEqual(again.state.characters.get(again.sessionId).slappable, false);
    });

    it("被打退後，從舊位置送來的移動被拒絕，不能抵銷打退（對方原本站著不動也一樣）", async () => {
        const { a, b, spawn } = await neighbours();
        await new Promise((r) => setTimeout(r, 500)); // 站著不動夠久，移動額度早就回滿
        await a.slap();
        const rejected: unknown[] = [];
        b.client.onMessage("moveRejected", (p: unknown) => rejected.push(p));

        b.client.send("move", { x: spawn.x + 18, y: spawn.y, dir: "left" });
        await b.server.waitForMessage("move");
        await new Promise((r) => setTimeout(r, 20));

        assert.strictEqual(b.character.position.x, spawn.x + 32);
        assert.strictEqual(rejected.length, 1);
    });
});

describe("遊戲桌與骰子比大小", () => {
    let colyseus: ColyseusTestServer<typeof appConfig>;

    before(async () => (colyseus = await testServer()));
    beforeEach(async () => colyseus.cleanup());

    let nextId = 3000;
    async function enter(name: string, user = { id: `${nextId++}`, name, guildId: GUILD_A }) {
        colyseus.sdk.auth.token = await JWT.sign(user);
        const client = await colyseus.sdk.joinOrCreate("town", { guildId: GUILD_A });
        const server = colyseus.getRoomById(client.roomId) as unknown as TownRoom;
        await server.waitForNextPatch();
        const results: { ok: boolean; message: string }[] = [];
        client.onMessage("tableResult", (r: { ok: boolean; message: string }) => results.push(r));
        const character = server.state.characters.get(client.sessionId);
        /** 送出動作，回傳伺服器回的提示（沒有回就是 undefined）。 */
        async function send(type: string) {
            const before = results.length;
            client.send(type);
            await server.waitForMessage(type);
            await server.waitForNextPatch();
            return results.length > before ? results.at(-1) : undefined;
        }
        /** 站到第一張遊戲桌旁邊。 */
        function walkToTable() {
            const spot = server.layout.tables[0];
            Object.assign(character.position, { x: spot.x, y: spot.y - 28 });
        }
        return { client, server, user, character, send, walkToTable, results, table: () => server.state.tables.get(server.layout.tables[0].id) };
    }

    async function seated(name: string) {
        const p = await enter(name);
        p.walkToTable();
        assert.strictEqual((await p.send("sit"))?.ok, true);
        return p;
    }

    it("走到桌旁入座：站到座位上，大家看得到誰坐哪；坐著不能走動", async () => {
        const a = await seated("小明");
        const spot = a.server.layout.tables[0];

        assert.strictEqual(a.character.seatedAt, spot.id);
        assert.deepStrictEqual([a.character.position.x, a.character.position.y], [spot.seats[0].x, spot.seats[0].y]);
        assert.strictEqual(a.client.state.tables.get(spot.id).seats[0], a.client.sessionId);

        a.client.send("move", { x: a.character.position.x, y: a.character.position.y + 4, dir: "down" });
        await a.server.waitForMessage("move");
        assert.strictEqual(a.character.position.y, spot.seats[0].y);
    });

    it("離桌子太遠不能入座", async () => {
        const a = await enter("小明");
        assert.deepStrictEqual(await a.send("sit"), { ok: false, message: "旁邊沒有遊戲桌" });
    });

    it("同一個帳號不能在兩個分頁都入座", async () => {
        const a = await seated("小明");
        const tab2 = await enter("小明", a.user);
        tab2.walkToTable();
        assert.deepStrictEqual(await tab2.send("sit"), { ok: false, message: "你已經在另一個分頁入座了" });
    });

    it("一個人下注不能擲骰", async () => {
        const a = await seated("小明");
        await a.send("bet");
        assert.deepStrictEqual(await a.send("roll"), { ok: false, message: "至少要兩個人下注才能擲骰" });
    });

    it("兩人下注擲骰：伺服器擲骰、籌碼立刻更新、總數不變，結果大家看得到", async () => {
        const a = await seated("小明");
        const b = await seated("小華");
        await a.send("bet");
        await b.send("bet");
        assert.strictEqual(a.table().bettors.length, 2);

        await a.send("roll");

        const chipsA = a.character.chips;
        const chipsB = b.character.chips;
        assert.strictEqual(chipsA + chipsB, 2000);
        assert.ok([950, 1000, 1050].includes(chipsA), `${chipsA}`);
        const result = JSON.parse(a.client.state.tables.get(a.server.layout.tables[0].id).result);
        assert.deepStrictEqual(result.map((r: { name: string }) => r.name), ["小明", "小華"]);
        assert.strictEqual(a.table().bettors.length, 0);
        // 帳本也記了：每人一筆下注，贏的人再一筆結算
        const historyA = a.server.ledger.history({ guildId: GUILD_A, userId: a.user.id });
        assert.strictEqual(historyA.at(-1)!.balance, chipsA);
    });

    it("下注後籌碼在別處用掉了：擲骰時他退出這一局，沒有人被扣到一半", async () => {
        const a = await seated("小明");
        const b = await seated("小華");
        await a.send("bet");
        await b.send("bet");
        a.server.ledger.change({ guildId: GUILD_A, userId: b.user.id }, -1000, "bet");

        assert.deepStrictEqual(await a.send("roll"), { ok: false, message: "至少要兩個人下注才能擲骰" });
        assert.deepStrictEqual([...a.table().bettors], [a.client.sessionId]);
        await new Promise((r) => setTimeout(r, 20));
        assert.deepStrictEqual(b.results.at(-1), { ok: false, message: "籌碼不夠 50，退出這一局" });
        assert.strictEqual(a.server.ledger.balance({ guildId: GUILD_A, userId: a.user.id }), 1000);
    });

    it("籌碼不夠不能下注", async () => {
        const a = await seated("小明");
        a.server.ledger.change({ guildId: GUILD_A, userId: a.user.id }, -980, "bet");
        assert.deepStrictEqual(await a.send("bet"), { ok: false, message: "籌碼不夠，每局要 50" });
    });

    it("擲骰前有人斷線：他退出這一局、不扣籌碼，座位空出來", async () => {
        const a = await seated("小明");
        const b = await seated("小華");
        await a.send("bet");
        await b.send("bet");

        await b.client.leave();
        await a.server.waitForNextPatch();

        assert.deepStrictEqual([...a.table().bettors], [a.client.sessionId]);
        assert.strictEqual(a.table().seats.filter((s) => s !== "").length, 1);
        assert.strictEqual(a.server.ledger.balance({ guildId: GUILD_A, userId: b.user.id }), 1000);
    });

    it("起身後可以走動", async () => {
        const a = await seated("小明");
        await a.send("stand");
        const { x, y } = a.character.position;

        a.client.send("move", { x, y: y - 4, dir: "up" });
        await a.server.waitForMessage("move");
        await new Promise((r) => setTimeout(r, 300)); // 等額度回復後再走一步
        a.client.send("move", { x, y: y - 8, dir: "up" });
        await a.server.waitForMessage("move");

        assert.strictEqual(a.character.seatedAt, "");
        assert.strictEqual(a.character.position.y, y - 8);
    });
});

describe("文字房", () => {
    let colyseus: ColyseusTestServer<typeof appConfig>;

    before(async () => (colyseus = await testServer()));
    beforeEach(async () => {
        await colyseus.cleanup();
        fakePlatform.sent.length = 0;
        fakePlatform.setMessages("c1", [{ id: "m1", author: "老王", content: "大家好", at: 1 }]);
    });
    afterEach(() => fakePlatform.setTextRefusal(undefined));

    type Panel = { channelId: string; name: string; messages: { content: string }[]; notice: string | null } | null;

    let nextId = 4000;
    /** 進小鎮，站到第 roomIndex 間房的門外；回傳走進去、走出來的函式和收到的面板訊息。 */
    async function standOutside(roomIndex: number) {
        const user = { id: `${nextId++}`, name: "小明", guildId: GUILD_A };
        colyseus.sdk.auth.token = await JWT.sign(user);
        const client = await colyseus.sdk.joinOrCreate("town", { guildId: GUILD_A });
        const server = colyseus.getRoomById(client.roomId) as unknown as TownRoom;
        await server.waitForNextPatch();
        const room = server.layout.rooms[roomIndex];
        const character = server.state.characters.get(client.sessionId);
        const doorX = room.rect.x + room.rect.width / 2;
        Object.assign(character.position, { x: doorX, y: room.rect.y - 24 });
        const panels: Panel[] = [];
        const live: unknown[] = [];
        const results: { ok: boolean; message: string }[] = [];
        client.onMessage("textRoom", (p: Panel) => panels.push(p));
        client.onMessage("textMessage", (m: unknown) => live.push(m));
        client.onMessage("textResult", (r: { ok: boolean; message: string }) => results.push(r));

        async function step(dy: number) {
            client.send("move", { x: doorX, y: character.position.y + dy, dir: dy > 0 ? "down" : "up" });
            await server.waitForMessage("move");
            await new Promise((r) => setTimeout(r, 220));
        }
        async function say(text: unknown) {
            client.send("say", text);
            await server.waitForMessage("say");
            await new Promise((r) => setTimeout(r, 20));
            return results.at(-1);
        }
        return {
            client, server, user, room, panels, live, results, say,
            enter: async () => { await step(16); await step(16); },
            leave: async () => { await step(-16); await step(-16); },
        };
    }

    it("走進文字房看到最新訊息，離開時面板收起", async () => {
        const { room, panels, enter, leave } = await standOutside(1); // c1 是文字房

        await enter();
        assert.deepStrictEqual(panels.at(-1), { channelId: room.id, name: room.name, messages: [{ id: "m1", author: "老王", content: "大家好", at: 1 }], notice: null });

        await leave();
        assert.strictEqual(panels.at(-1), null);
    });

    it("新訊息即時送給站在那間文字房裡的人，不在房裡的人收不到", async () => {
        const inside = await standOutside(1);
        await inside.enter();
        const outside = await standOutside(3);

        fakePlatform.emitMessage(GUILD_A, "c1", { id: "m2", author: "老王", content: "有人嗎", at: 2 });
        await new Promise((r) => setTimeout(r, 50));

        assert.deepStrictEqual(inside.live, [{ channelId: "c1", message: { id: "m2", author: "老王", content: "有人嗎", at: 2 } }]);
        assert.deepStrictEqual(outside.live, []);
    });

    it("在文字房發言：以成員的名字發到那個頻道", async () => {
        const { user, say, enter } = await standOutside(1);
        await enter();

        assert.strictEqual(await say("  晚安  "), undefined);
        assert.deepStrictEqual(fakePlatform.sent, [{ guildId: GUILD_A, channelId: "c1", userId: user.id, name: "小明", text: "晚安" }]);
    });

    it("不在文字房、空白、太長、發太快都不會發出去，並告訴原因", async () => {
        const { say, enter } = await standOutside(1);
        assert.deepStrictEqual(await say("哈囉"), { ok: false, message: "要站在文字房裡才能發言" });
        await enter();
        assert.deepStrictEqual(await say("   "), { ok: false, message: "訊息不能是空的" });
        assert.deepStrictEqual(await say(42), { ok: false, message: "訊息不能是空的" });
        assert.deepStrictEqual(await say("a".repeat(2001)), { ok: false, message: "訊息最多 2000 字" });
        await say("第一則");
        assert.deepStrictEqual(await say("第二則"), { ok: false, message: "發太快了，等一下再發" });
        assert.strictEqual(fakePlatform.sent.length, 1);
    });

    it("讀不到訊息（例如沒打開 Message Content）時面板顯示原因，不是空白", async () => {
        fakePlatform.setTextRefusal("bot 還讀不到訊息內容");
        const { panels, enter, say } = await standOutside(1);

        await enter();
        assert.deepStrictEqual(panels.at(-1)?.notice, "bot 還讀不到訊息內容");
        assert.deepStrictEqual(await say("哈囉"), { ok: false, message: "bot 還讀不到訊息內容" });
    });

    it("走進語音房不會打開文字面板", async () => {
        const { panels, enter } = await standOutside(0);
        await enter();
        assert.deepStrictEqual(panels, []);
    });
});
