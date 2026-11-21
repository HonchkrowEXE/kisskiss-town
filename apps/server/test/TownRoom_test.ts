import assert from "assert";
import type { ColyseusTestServer } from "@colyseus/testing";
import { JWT } from "colyseus";
import type appConfig from "../src/app.config.js";
import { testServer } from "./testServer.js";
import type { TownRoom } from "../src/rooms/TownRoom.js";

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

    it("小鎮裡顯示登入時取得的名字", async () => {
        const a = await join(xiaoming);
        await colyseus.getRoomById(a.roomId).waitForNextPatch();

        assert.strictEqual(a.state.players.get(a.sessionId).name, "鎮長小明");
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
        assert.ok(a.state.players.get(b.sessionId));

        await b.leave();
        await server.waitForNextPatch();

        assert.strictEqual(a.state.players.get(b.sessionId), undefined);
    });
});

describe("走動", () => {
    let colyseus: ColyseusTestServer<typeof appConfig>;

    before(async () => (colyseus = await testServer()));
    beforeEach(async () => colyseus.cleanup());

    /** 進小鎮，並把角色放到 (24, 24)：預設地圖左上角第一格地板的中央，左邊和上面都是牆。 */
    async function enterAtCorner() {
        colyseus.sdk.auth.token = await JWT.sign({ id: "1", name: "小明", guildId: GUILD_A });
        const client = await colyseus.sdk.joinOrCreate("town", { guildId: GUILD_A });
        const server = colyseus.getRoomById(client.roomId) as unknown as TownRoom;
        const player = server.state.players.get(client.sessionId);
        player.position.x = 24;
        player.position.y = 24;
        return { client, server, player };
    }

    /** 送出移動，等伺服器處理完；有被拒絕的話回傳伺服器拉回的位置。 */
    async function move(client: any, server: any, message: unknown) {
        let rejected: { x: number; y: number } | undefined;
        client.onMessage("moveRejected", (pos: { x: number; y: number }) => (rejected = pos));
        client.send("move", message);
        await server.waitForMessage("move");
        await server.waitForNextPatch(); // 讓 moveRejected 也有時間送回前端
        return rejected;
    }

    it("出生在可以站的地方", async () => {
        colyseus.sdk.auth.token = await JWT.sign({ id: "1", name: "小明", guildId: GUILD_A });
        const client = await colyseus.sdk.joinOrCreate("town", { guildId: GUILD_A });
        const server = colyseus.getRoomById(client.roomId) as unknown as TownRoom;
        const { x, y } = server.state.players.get(client.sessionId).position;

        assert.ok(server.walkable.canStand(x, y), `生在 (${x}, ${y})`);
    });

    it("合法的移動被採用，也記下面向", async () => {
        const { client, server, player } = await enterAtCorner();

        const rejected = await move(client, server, { x: 28, y: 24, dir: "right" });

        assert.strictEqual(rejected, undefined);
        assert.deepStrictEqual([player.position.x, player.position.y, player.dir], [28, 24, "right"]);
    });

    it("走進牆裡被拒絕，前端收到原本的位置", async () => {
        const { client, server, player } = await enterAtCorner();

        const rejected = await move(client, server, { x: 19, y: 24, dir: "left" });

        assert.deepStrictEqual(rejected, { x: 24, y: 24 });
        assert.deepStrictEqual([player.position.x, player.position.y], [24, 24]);
    });

    it("一次移動太遠（瞬移）被拒絕", async () => {
        const { client, server, player } = await enterAtCorner();

        const rejected = await move(client, server, { x: 248, y: 200, dir: "right" });

        assert.deepStrictEqual(rejected, { x: 24, y: 24 });
        assert.deepStrictEqual([player.position.x, player.position.y], [24, 24]);
    });

    it("連發小步也不能超過速度上限", async () => {
        const { client, server, player } = await enterAtCorner();

        // 一口氣送 20 步、每步 4px（共 80px），遠超過累積的額度
        let x = 24;
        client.onMessage("moveRejected", () => {});
        for (let i = 0; i < 20; i++) client.send("move", { x: (x += 4), y: 24, dir: "right" });
        await new Promise((r) => setTimeout(r, 200));

        assert.ok(player.position.x < 24 + 80, `跑到了 x=${player.position.x}`);
    });

    it("格式不對的訊息被拒絕", async () => {
        const { client, server, player } = await enterAtCorner();

        for (const bad of [{ x: "abc", y: 24, dir: "right" }, { x: 28, y: 24, dir: "fly" }, null]) {
            const rejected = await move(client, server, bad);
            assert.deepStrictEqual(rejected, { x: 24, y: 24 }, JSON.stringify(bad));
        }
        assert.deepStrictEqual([player.position.x, player.position.y, player.dir], [24, 24, "down"]);
    });
});
