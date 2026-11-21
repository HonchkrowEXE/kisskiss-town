import assert from "assert";
import type { ColyseusTestServer } from "@colyseus/testing";
import { JWT } from "colyseus";
import type appConfig from "../src/app.config.js";
import { testServer, fakePlatform } from "./testServer.js";
import type { TownRoom } from "../src/rooms/TownRoom.js";
import { BUBBLE_MAX } from "../src/rooms/features/SpeechBubbles.js";

const GUILD_A = "9000000000000000001";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("頭上的對話框", () => {
    let colyseus: ColyseusTestServer<typeof appConfig>;

    before(async () => (colyseus = await testServer()));
    beforeEach(async () => colyseus.cleanup());

    async function enter() {
        colyseus.sdk.auth.token = await JWT.sign({ id: "bubble-1", name: "小明", guildId: GUILD_A });
        const client = await colyseus.sdk.joinOrCreate("town", { guildId: GUILD_A });
        const server = colyseus.getRoomById(client.roomId) as unknown as TownRoom;
        await server.waitForNextPatch();
        const bubbles: unknown[] = [];
        client.onMessage("bubble", (b: unknown) => bubbles.push(b));
        return { bubbles };
    }
    const say = (channelId: string, content: string) =>
        fakePlatform.emitMessage(GUILD_A, channelId, { id: "m", author: "老王", authorId: "laowang", content, at: 1 });

    it("在語音頻道的文字聊天打字，大家收到那個人頭上的對話框", async () => {
        const { bubbles } = await enter();
        say("c0", "大家晚安"); // c0 是語音房
        await wait(30);
        assert.deepStrictEqual(bubbles, [{ userId: "laowang", text: "大家晚安" }]);
    });

    it("文字房的訊息、空訊息不出對話框；太長的截斷", async () => {
        const { bubbles } = await enter();
        say("c1", "文字房的話");
        say("c0", "");
        say("c2", "字".repeat(BUBBLE_MAX + 10));
        await wait(30);
        assert.deepStrictEqual(bubbles, [{ userId: "laowang", text: `${"字".repeat(BUBBLE_MAX)}…` }]);
    });
});
