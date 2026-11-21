import assert from "assert";
import type { ColyseusTestServer } from "@colyseus/testing";
import { JWT } from "colyseus";
import type appConfig from "../src/app.config.js";
import { testServer } from "./testServer.js";
import type { TownRoom } from "../src/rooms/TownRoom.js";
import { DEFAULT_APPEARANCE, appearanceFromJson, parseAppearance, type Appearance } from "../src/town/appearance.js";

const GUILD_A = "9000000000000000001";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const LOOK: Appearance = { hair: "long", hairColor: "金", skin: "深", top: "hoodie", topColor: "綠", bottom: "skirt", bottomColor: "黑", shoesColor: "白" };

describe("外觀", () => {
    it("每個欄位都是可選的值才接受，多的欄位丟掉", () => {
        assert.deepStrictEqual(parseAppearance({ ...LOOK, extra: "x" }), LOOK);
        assert.strictEqual(parseAppearance({ ...LOOK, hair: "mohawk" }), undefined);
        assert.strictEqual(parseAppearance({ ...LOOK, topColor: "#ff00ff" }), undefined);
        assert.strictEqual(parseAppearance({ ...LOOK, hair: "toString" }), undefined); // 不能拿物件原型上的名字
        assert.strictEqual(parseAppearance("long"), undefined);
    });

    it("同步狀態裡的 JSON 壞掉或空的時候用預設", () => {
        assert.deepStrictEqual(appearanceFromJson(""), DEFAULT_APPEARANCE);
        assert.deepStrictEqual(appearanceFromJson("{"), DEFAULT_APPEARANCE);
        assert.deepStrictEqual(appearanceFromJson(JSON.stringify(LOOK)), LOOK);
    });
});

describe("換裝", () => {
    let colyseus: ColyseusTestServer<typeof appConfig>;

    before(async () => (colyseus = await testServer()));
    beforeEach(async () => colyseus.cleanup());

    let nextId = 6000;
    async function enter(user = { id: `${nextId++}`, name: "小明", guildId: GUILD_A }) {
        colyseus.sdk.auth.token = await JWT.sign(user);
        const client = await colyseus.sdk.joinOrCreate("town", { guildId: GUILD_A });
        const server = colyseus.getRoomById(client.roomId) as unknown as TownRoom;
        await server.waitForNextPatch();
        const results: { ok: boolean; message: string }[] = [];
        client.onMessage("wardrobeResult", (r: { ok: boolean; message: string }) => results.push(r));
        const look = () => JSON.parse(server.state.characters.get(client.sessionId)!.look);
        async function setLook(input: unknown) {
            client.send("setLook", input);
            await server.waitForMessage("setLook");
            await wait(20);
            return results.at(-1);
        }
        return { client, server, user, look, setLook };
    }

    it("沒設定過的成員用預設外觀", async () => {
        const a = await enter();
        assert.deepStrictEqual(a.look(), DEFAULT_APPEARANCE);
    });

    it("存檔後自己每個分頁和其他人都看到新外觀；重進小鎮還在", async () => {
        const a = await enter();
        const tab2 = await enter(a.user);
        assert.deepStrictEqual(await a.setLook(LOOK), { ok: true, message: "換好了" });
        assert.deepStrictEqual(a.look(), LOOK);
        assert.deepStrictEqual(tab2.look(), LOOK);

        await a.client.leave();
        await tab2.client.leave();
        const again = await enter(a.user);
        assert.deepStrictEqual(again.look(), LOOK);
    });

    it("不能選的部件被拒，外觀不變", async () => {
        const a = await enter();
        assert.deepStrictEqual(await a.setLook({ ...LOOK, hair: "mohawk" }), { ok: false, message: "有部件不能選，請重新選一次" });
        assert.deepStrictEqual(a.look(), DEFAULT_APPEARANCE);
    });
});
