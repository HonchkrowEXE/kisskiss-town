import assert from "assert";
import type { ColyseusTestServer } from "@colyseus/testing";
import { JWT } from "colyseus";
import type appConfig from "../src/app.config.js";
import { testServer } from "./testServer.js";

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
});
