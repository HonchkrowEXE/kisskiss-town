import assert from "assert";
import type { ColyseusTestServer } from "@colyseus/testing";
import { JWT } from "colyseus";
import type appConfig from "../src/app.config.js";
import { testServer, fakePlatform } from "./testServer.js";
import type { TownRoom } from "../src/rooms/TownRoom.js";
import { PlannerRejected, describeChannels, toTownPlan, useTownPlanner, type PlannerOutput } from "../src/town/planTown.js";
import type { TownChannel } from "../src/town/layoutTown.js";

const GUILD_A = "9000000000000000001";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const channels: TownChannel[] = [
    { id: "a", name: "大廳", kind: "voice", category: "聊天" },
    { id: "b", name: "公告", kind: "text" },
    { id: "c", name: "遊戲", kind: "voice" },
];

describe("Claude 設計小鎮：規劃轉換", () => {
    it("頻道清單用編號給 Claude 看，帶種類和分類", () => {
        assert.strictEqual(describeChannels(channels).split("\n")[0], "#1 語音「大廳」（分類：聊天）");
    });

    it("編號換成頻道 ID；不存在、重複的編號丟掉；名稱太長截斷；空的分區丟掉", () => {
        const output: PlannerOutput = {
            summary: "",
            districts: [
                { name: "  熱鬧的大客廳一定要放最前面喔  ", size: "large", floor: "wood", channels: [3, 1, 99, 3] },
                { name: "空", size: "small", floor: "tile", channels: [0, 1] },
                { name: "書房", size: "small", floor: "tile", channels: [2] },
            ],
        };
        assert.deepStrictEqual(toTownPlan(output, channels).districts, [
            { name: "熱鬧的大客廳一定要放最前", channels: ["c", "a"], size: "large", floor: "wood" },
            { name: "書房", channels: ["b"], size: "small", floor: "tile" },
        ]);
    });

    it("一個頻道都沒用到就算失敗", () => {
        assert.throws(() => toTownPlan({ summary: "", districts: [{ name: "x", size: "small", floor: "tile", channels: [7] }] }, channels), PlannerRejected);
    });
});

describe("選地圖（/town_map）", () => {
    let colyseus: ColyseusTestServer<typeof appConfig>;
    const GUILD_NEW = "9000000000000000077";

    before(async () => {
        colyseus = await testServer();
        fakePlatform.setChannels(GUILD_NEW, channels);
    });
    beforeEach(async () => colyseus.cleanup());
    afterEach(() => fakePlatform.admins.clear());

    let nextId = 7700;
    async function enter(guildId: string, admin = true) {
        const user = { id: `${nextId++}`, name: "鎮長", guildId };
        if (admin) fakePlatform.admins.add(user.id);
        const token = await JWT.sign(user);
        colyseus.sdk.auth.token = token;
        const client = await colyseus.sdk.joinOrCreate("town", { guildId });
        const adminMessage = new Promise<{ mapChosen: boolean }>((resolve) => client.onMessage("admin", resolve));
        const server = colyseus.getRoomById(client.roomId) as unknown as TownRoom;
        await server.waitForNextPatch();
        const post = (body: object) => colyseus.http.post("/town_map", { body, headers: { Authorization: `Bearer ${token}` } });
        return { client, server, post, adminMessage };
    }

    it("新伺服器：管理員進來時還沒選地圖；Claude 照描述設計後大家換成新地圖，之後不再跳出", async () => {
        const prompts: string[] = [];
        useTownPlanner(async (list, prompt) => {
            prompts.push(prompt);
            assert.deepStrictEqual(list.map((c) => c.id), ["a", "b", "c"]);
            return { summary: "遊戲放最前面", districts: [{ name: "遊戲區", size: "large", floor: "carpet", channels: [3] }] };
        });
        const a = await enter(GUILD_NEW);
        assert.strictEqual((await a.adminMessage).mapChosen, false);

        const { data } = await a.post({ prompt: "像一間網咖" });
        assert.deepStrictEqual(data, { ok: true, message: "Claude 設計好了：遊戲放最前面" });
        assert.deepStrictEqual(prompts, ["像一間網咖"]);
        await wait(50);
        const map = JSON.parse(a.server.state.map);
        assert.deepStrictEqual(map.rooms.map((r: { id: string }) => r.id), ["c", "a", "b"]); // 沒提到的放到「其他」
        assert.deepStrictEqual(map.labels.map((l: { text: string }) => l.text), ["遊戲區", "其他"]);

        await a.client.leave();
        const again = await enter(GUILD_NEW);
        assert.strictEqual((await again.adminMessage).mapChosen, true);

        await again.post({ reset: true }); // 改回照頻道自動產生
        await wait(50);
        assert.deepStrictEqual(JSON.parse(again.server.state.map).rooms.map((r: { id: string }) => r.id), ["a", "b", "c"]);
    });

    it("描述空白或太長被拒；不是管理員不能換", async () => {
        const a = await enter(GUILD_NEW);
        await assert.rejects(a.post({ prompt: "  " }), (e: any) => e.statusCode === 400);
        await assert.rejects(a.post({ prompt: "長".repeat(501) }), (e: any) => e.statusCode === 400);
        const member = await enter(GUILD_NEW, false);
        await assert.rejects(member.post({ prompt: "像一間網咖" }), (e: any) => e.statusCode === 403);
    });
});
