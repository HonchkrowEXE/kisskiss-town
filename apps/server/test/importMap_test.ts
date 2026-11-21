import assert from "assert";
import type { ColyseusTestServer } from "@colyseus/testing";
import { JWT } from "colyseus";
import type appConfig from "../src/app.config.js";
import { testServer, fakePlatform } from "./testServer.js";
import type { TownRoom } from "../src/rooms/TownRoom.js";
import { MapImportError, importedLayout, validateImport } from "../src/town/importMap.js";
import { createWalkable } from "../src/town/walkable.js";

const GUILD_A = "9000000000000000001";
const PNG = "data:image/png;base64,iVBORw0KGgo=";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 10×8 格、每格 16px 的空地。 */
const blank = () => new Array<number>(10 * 8).fill(1);

/** Tiled 匯出的樣子：圖塊集標 collides、area 物件綁頻道、spawn 物件。 */
function tiledSample() {
    const ground = blank();
    for (let x = 0; x < 10; x++) ground[x] = 2; // 最上面一排是牆
    return {
        type: "map", orientation: "orthogonal", infinite: false, renderorder: "right-down", version: "1.10", tiledversion: "1.11.0",
        width: 10, height: 8, tilewidth: 16, tileheight: 16,
        layers: [
            { type: "tilelayer", name: "Ground", width: 10, height: 8, x: 0, y: 0, opacity: 1, visible: true, data: ground },
            {
                type: "objectgroup", name: "Areas", visible: true, objects: [
                    { id: 1, name: "大廳", class: "area", x: 16, y: 32, width: 64, height: 48, properties: [{ name: "channel", type: "string", value: "c0" }] },
                    { id: 2, name: "秘密", class: "area", x: 96, y: 32, width: 32, height: 32, properties: [{ name: "channel", type: "string", value: "private-1" }] },
                    { id: 3, name: "spawn", x: 80, y: 96, point: true },
                ],
            },
        ],
        tilesets: [{
            firstgid: 1, name: "town", image: "../art/town.png", imagewidth: 32, imageheight: 16, tilewidth: 16, tileheight: 16, columns: 2, tilecount: 2, margin: 0, spacing: 0,
            tiles: [{ id: 1, properties: [{ name: "collides", type: "bool", value: true }] }],
        }],
    };
}

/** tilemap.dev 匯出的樣子：Colliders 物件群組、隱藏的 Collision 圖層、Spawn Points 群組。 */
function tilemapDevSample() {
    const collision = new Array<number>(10 * 8).fill(0);
    collision[7 * 10 + 9] = 1; // 右下角一格
    return {
        width: 10, height: 8, tilewidth: 16, tileheight: 16, orientation: "orthogonal", infinite: false,
        layers: [
            { type: "tilelayer", name: "Floor", visible: true, data: blank() },
            { type: "tilelayer", name: "Collision", visible: false, data: collision },
            { type: "objectgroup", name: "Colliders", objects: [{ id: 1, x: 0, y: 0, width: 160, height: 16 }] },
            { type: "objectgroup", name: "Spawn Points", objects: [{ id: 2, name: "start", x: 40, y: 72, point: true }] },
        ],
        tilesets: [{ firstgid: 1, name: "tiles", image: "tiles.png", imagewidth: 16, imageheight: 16, tilewidth: 16, tileheight: 16, columns: 1, tilecount: 1 }],
    };
}

const CHANNELS = [{ id: "c0", name: "頻道0", kind: "voice" as const }, { id: "c1", name: "頻道1", kind: "text" as const }];

describe("匯入地圖", () => {
    it("Tiled 的樣本：圖塊集標 collides 的是牆、area 物件變成房間、spawn 物件是出生點；圖片路徑只留檔名", () => {
        const stored = validateImport(tiledSample(), { "town.png": PNG, "unused.png": PNG });
        assert.strictEqual(stored.map.tilesets[0].image, "town.png");
        assert.deepStrictEqual(Object.keys(stored.images), ["town.png"]);

        const layout = importedLayout(stored, CHANNELS);
        assert.deepStrictEqual(layout.rooms.map((r) => [r.id, r.name, r.kind]), [["c0", "頻道0", "voice"]]); // 私人頻道不算
        assert.deepStrictEqual(layout.rooms[0].rect, { x: 16, y: 32, width: 64, height: 48 });
        assert.deepStrictEqual(layout.spawn, { x: 80, y: 96 });
        const walkable = createWalkable(layout.map);
        assert.ok(!walkable.canStand(40, 8), "最上面一排是牆");
        assert.ok(walkable.canStand(40, 40));
    });

    it("tilemap.dev 的樣本：Colliders 群組和 Collision 圖層都是牆、Spawn Points 是出生點", () => {
        const layout = importedLayout(validateImport(tilemapDevSample(), { "tiles.png": PNG }), CHANNELS);
        const walkable = createWalkable(layout.map);
        assert.ok(!walkable.canStand(40, 8), "Colliders 蓋住最上面一排");
        assert.ok(!walkable.canStand(152, 120), "Collision 圖層右下角那格");
        assert.ok(walkable.canStand(72, 72));
        assert.deepStrictEqual(layout.spawn, { x: 40, y: 72 });
        assert.deepStrictEqual(layout.rooms, []);
    });

    it("沒有出生點時用地圖中央", () => {
        const sample = tilemapDevSample();
        sample.layers = sample.layers.filter((l) => l.name !== "Spawn Points");
        assert.deepStrictEqual(importedLayout(validateImport(sample, { "tiles.png": PNG }), []).spawn, { x: 80, y: 64 });
    });

    it("格式錯誤或缺圖片時，給看得懂的錯誤", () => {
        const expect = (input: unknown, images: unknown, pattern: RegExp) =>
            assert.throws(() => validateImport(input, images), (e: unknown) => e instanceof MapImportError && pattern.test(e.message));
        expect("hello", {}, /不是 Tiled JSON/);
        expect({ ...tiledSample(), width: 0 }, {}, /寬、高/);
        expect(tiledSample(), {}, /缺少圖塊圖片：town\.png/);
        expect(tiledSample(), { "town.png": "data:text/html;base64,PGI+" }, /不是 PNG/);
        expect({ ...tiledSample(), infinite: true }, { "town.png": PNG }, /無限地圖/);
        expect({ ...tiledSample(), orientation: "isometric" }, { "town.png": PNG }, /方形格子/);
        const external = tiledSample();
        (external.tilesets[0] as Record<string, unknown>).source = "town.tsx";
        expect(external, { "town.png": PNG }, /外部圖塊集/);
        const base64Layer = tiledSample();
        (base64Layer.layers[0] as Record<string, unknown>).data = "eJzt";
        expect(base64Layer, { "town.png": PNG }, /CSV/);
    });
});

describe("/town_map 路由", () => {
    let colyseus: ColyseusTestServer<typeof appConfig>;

    before(async () => (colyseus = await testServer()));
    beforeEach(async () => colyseus.cleanup());
    afterEach(() => fakePlatform.admins.clear());

    let nextId = 8000;
    async function enter({ admin = false } = {}) {
        const user = { id: `${nextId++}`, name: "鎮長", guildId: GUILD_A };
        if (admin) fakePlatform.admins.add(user.id);
        const token = await JWT.sign(user);
        colyseus.sdk.auth.token = token;
        const client = await colyseus.sdk.joinOrCreate("town", { guildId: GUILD_A });
        const server = colyseus.getRoomById(client.roomId) as unknown as TownRoom;
        await server.waitForNextPatch();
        const post = (body: object) => colyseus.http.post("/town_map", { body, headers: { Authorization: `Bearer ${token}` } });
        return { client, server, post };
    }

    it("管理員匯入後，在線成員的地圖換成新地圖（房間從 area 物件來）；改回自動也會換回來", async () => {
        const { server, post } = await enter({ admin: true });
        const { data } = await post({ map: tiledSample(), images: { "town.png": PNG } });
        assert.strictEqual(data.ok, true);
        await wait(50);
        let map = JSON.parse(server.state.map);
        assert.deepStrictEqual([map.map.width, map.images["town.png"]], [10, PNG]);
        assert.deepStrictEqual(map.rooms.map((r: { id: string }) => r.id), ["c0"]);

        await post({ reset: true });
        await wait(50);
        map = JSON.parse(server.state.map);
        assert.strictEqual(map.images, undefined);
        assert.strictEqual(map.rooms.length, 8); // 回到依頻道自動長出來
    });

    it("格式錯誤時回錯誤訊息，地圖不變", async () => {
        const { server, post } = await enter({ admin: true });
        const before = server.state.map;
        await assert.rejects(post({ map: tiledSample(), images: {} }), (e: any) => e.statusCode === 400 && /town\.png/.test(JSON.stringify(e.data)));
        assert.strictEqual(server.state.map, before);
    });

    it("一般成員不能換地圖", async () => {
        const { post } = await enter();
        await assert.rejects(post({ reset: true }), (e: any) => e.statusCode === 403);
    });
});
