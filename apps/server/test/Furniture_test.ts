import assert from "assert";
import type { ColyseusTestServer } from "@colyseus/testing";
import { JWT } from "colyseus";
import type appConfig from "../src/app.config.js";
import { testServer, fakePlatform } from "./testServer.js";
import type { TownRoom } from "../src/rooms/TownRoom.js";
import { layoutTown } from "../src/town/layoutTown.js";
import { blockedTiles, canPlaceObject, centerOf, defaultFurniture } from "../src/town/objects.js";
import { createWalkable } from "../src/town/walkable.js";

const GUILD_A = "9000000000000000001";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const CHANNELS = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, name: `頻道${i}`, kind: (i % 2 ? "text" : "voice") as "text" | "voice" }));

describe("預設家具", () => {
    const layout = layoutTown(CHANNELS);
    const base = createWalkable(layout.map);
    const objects = defaultFurniture(layout);

    it("每個房間都有桌子和兩張椅子；語音房有電視、文字房有電腦", () => {
        for (const room of layout.rooms) {
            const mine = objects.filter((o) => o.id.startsWith(`${room.id}-`)).map((o) => o.kind).sort();
            assert.deepStrictEqual(mine, (room.kind === "voice" ? ["chair", "chair", "table", "tv"] : ["chair", "chair", "computer", "table"]).sort());
        }
    });

    it("每件都放得下、不重疊；擺好後從門口還走得進房間", () => {
        const placed: typeof objects = [];
        for (const o of objects) {
            assert.ok(canPlaceObject(o, layout, base, placed), `${o.id} 放不下`);
            placed.push(o);
        }
        const withFurniture = createWalkable(layout.map, blockedTiles(objects, layout.map.width));
        for (const room of layout.rooms) {
            const doorX = room.rect.x + room.rect.width / 2;
            assert.ok(withFurniture.canWalk({ x: doorX, y: room.rect.y - 8 }, { x: doorX, y: room.rect.y + 24 }), `${room.id} 門口被擋住`);
        }
    });
});

describe("家具", () => {
    let colyseus: ColyseusTestServer<typeof appConfig>;

    before(async () => (colyseus = await testServer()));
    beforeEach(async () => colyseus.cleanup());
    afterEach(() => {
        fakePlatform.admins.clear();
        fakePlatform.setVoice(GUILD_A, []);
    });

    let nextId = 9000;
    async function enter({ admin = false } = {}) {
        const user = { id: `${nextId++}`, name: "小明", guildId: GUILD_A };
        if (admin) fakePlatform.admins.add(user.id);
        colyseus.sdk.auth.token = await JWT.sign(user);
        const client = await colyseus.sdk.joinOrCreate("town", { guildId: GUILD_A });
        const server = colyseus.getRoomById(client.roomId) as unknown as TownRoom;
        await server.waitForNextPatch();
        const character = server.state.characters.get(client.sessionId)!;
        const log: Record<string, { ok?: boolean; message?: string; id?: string; kind?: string }[]> = {};
        for (const type of ["tableResult", "boardResult", "adminResult", "openObject", "voiceMove"]) {
            log[type] = [];
            client.onMessage(type, (m: { ok?: boolean; message?: string; id?: string; kind?: string }) => log[type].push(m));
        }
        async function send(type: string, payload?: unknown) {
            client.send(type, payload);
            await server.waitForMessage(type);
            await wait(30);
        }
        /** 站到某件家具旁邊（下面一格）。 */
        function standBy(kind: string) {
            const [id, o] = [...server.state.objects.entries()].find(([, x]) => x.kind === kind)!;
            const c = centerOf({ id, kind: o.kind as never, x: o.x, y: o.y }, 16);
            Object.assign(character.position, { x: c.x, y: c.y + 16 });
            return id;
        }
        return { client, server, user, character, log, send, standBy };
    }

    it("一進小鎮就看到預設家具；擋路的家具算進碰撞", async () => {
        const p = await enter();
        assert.ok(p.server.state.objects.size > 0);
        const [, table] = [...p.server.state.objects.entries()].find(([, o]) => o.kind === "table")!;
        assert.ok(!p.server.walkable.canStand(table.x * 16 + 8, table.y * 16 + 8), "站不到桌子上");
    });

    it("椅子：按 E 坐下（不能走）、再按一次起身；有人坐了別人不能坐", async () => {
        const a = await enter();
        const chairId = a.standBy("chair");
        await a.send("interact");
        assert.strictEqual(a.character.seatedAt, `chair:${chairId}`);
        assert.strictEqual(a.server.state.objects.get(chairId)!.sittingBy, a.client.sessionId);

        const b = await enter();
        Object.assign(b.character.position, { x: a.character.position.x, y: a.character.position.y + 16 });
        await b.send("interact");
        assert.deepStrictEqual(b.log.tableResult.at(-1), { ok: false, message: "這張椅子有人坐了" });

        await a.send("interact");
        assert.strictEqual(a.character.seatedAt, "");
        assert.strictEqual(a.server.state.objects.get(chairId)!.sittingBy, "");
    });

    it("用滑鼠點的家具：兩張椅子中間時坐點的那張；點太遠的說明；點的不是家具交給遊戲桌", async () => {
        const a = await enter();
        const chairs = [...a.server.state.objects.entries()].filter(([, o]) => o.kind === "chair");
        const [rightId, right] = chairs.find(([id]) => id.endsWith("chair-r"))!;
        // 站在桌子正下方：離左右兩張椅子一樣遠
        Object.assign(a.character.position, { x: (right.x - 1) * 16, y: (right.y + 1) * 16 + 8 });
        await a.send("interact", { target: rightId });
        assert.strictEqual(a.character.seatedAt, `chair:${rightId}`);
        await a.send("interact", { target: rightId }); // 再點一次起身
        assert.strictEqual(a.character.seatedAt, "");

        const [farId] = chairs.find(([id]) => !id.startsWith(rightId.replace("chair-r", "")))!;
        await a.send("interact", { target: farId });
        assert.deepStrictEqual(a.log.tableResult.at(-1), { ok: false, message: "離太遠了，走近一點" });
        assert.strictEqual(a.character.seatedAt, "");

        await a.send("interact", { target: "不存在" });
        assert.deepStrictEqual(a.log.tableResult.at(-1), { ok: false, message: "旁邊沒有可以互動的東西" });
    });

    it("旁邊沒有東西時按 E 說明", async () => {
        const a = await enter();
        Object.assign(a.character.position, { x: a.server.layout.spawn.x, y: a.server.layout.spawn.y });
        await a.send("interact");
        assert.deepStrictEqual(a.log.tableResult.at(-1), { ok: false, message: "旁邊沒有可以互動的東西" });
    });

    it("電腦：按 E 打開揪團看板；貼一則連結、別人看得到、只能刪自己的；連結要 http(s)", async () => {
        const a = await enter();
        const id = a.standBy("computer");
        await a.send("interact");
        assert.deepStrictEqual(a.log.openObject.at(-1), { id, kind: "computer" });

        await a.send("postBoard", { id, title: "  積分缺一  ", url: "javascript:alert(1)" });
        assert.strictEqual(a.log.boardResult.at(-1)?.ok, false);
        await a.send("postBoard", { id, title: "積分缺一", url: "https://example.com/lobby" });
        const posts = JSON.parse(a.server.state.objects.get(id)!.board);
        assert.deepStrictEqual([posts[0].title, posts[0].url, posts[0].by], ["積分缺一", "https://example.com/lobby", "小明"]);

        const b = await enter();
        b.standBy("computer");
        await b.send("removeBoardPost", { id, at: posts[0].at });
        assert.strictEqual(JSON.parse(a.server.state.objects.get(id)!.board).length, 1, "別人刪不掉");
        await a.send("removeBoardPost", { id, at: posts[0].at });
        assert.strictEqual(JSON.parse(a.server.state.objects.get(id)!.board).length, 0);
    });

    it("離電腦太遠不能貼", async () => {
        const a = await enter();
        const id = a.standBy("computer");
        Object.assign(a.character.position, { x: a.server.layout.spawn.x, y: a.server.layout.spawn.y });
        await a.send("postBoard", { id, title: "缺一", url: "https://example.com" });
        assert.deepStrictEqual(a.log.boardResult.at(-1), { ok: false, message: "要站在電腦旁邊才能貼" });
    });

    it("電視：按 E 打開；去看直播會把人搬進電視所在的語音頻道", async () => {
        const a = await enter();
        fakePlatform.setVoice(GUILD_A, [{ userId: a.user.id, name: "小明", channelId: "c2", muted: false, deafened: false, streaming: false }]);
        const id = a.standBy("tv");
        await a.send("interact");
        assert.strictEqual(a.log.openObject.at(-1)?.kind, "tv");
        await a.send("watchTv", { id });
        assert.strictEqual(a.log.voiceMove.at(-1)?.ok, true);
    });

    it("管理員：在格子上放家具、放不下的被拒、移除、改回預設；一般成員不能擺", async () => {
        const member = await enter();
        await member.send("placeObject", { kind: "chair", x: 10, y: 2 });
        assert.strictEqual(member.log.adminResult.at(-1)?.ok, false);

        const admin = await enter({ admin: true });
        await admin.send("placeObject", { kind: "tv", x: 10, y: 2 });
        assert.deepStrictEqual(admin.log.adminResult.at(-1), { ok: true, message: "放了電視" });
        const [newId] = [...admin.server.state.objects.entries()].find(([, o]) => o.kind === "tv" && o.x === 10 && o.y === 2)!;

        await admin.send("placeObject", { kind: "table", x: 0, y: 0 }); // 角落是牆
        assert.strictEqual(admin.log.adminResult.at(-1)?.ok, false);
        await admin.send("placeObject", { kind: "chair", x: 10, y: 2 }); // 疊在電視上
        assert.strictEqual(admin.log.adminResult.at(-1)?.ok, false);

        await admin.send("removeObject", { id: newId });
        assert.strictEqual(admin.server.state.objects.has(newId), false);

        await admin.send("resetObjects");
        assert.strictEqual(admin.server.townSettings.objects(GUILD_A), undefined);
    });
});
