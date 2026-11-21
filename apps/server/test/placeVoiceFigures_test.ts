import assert from "assert";
import { layoutTown } from "../src/town/layoutTown.js";
import { placeVoiceFigures } from "../src/town/placeVoiceFigures.js";
import { createWalkable } from "../src/town/walkable.js";

const layout = layoutTown([
    { id: "lobby", name: "大廳", kind: "voice" },
    { id: "game", name: "遊戲", kind: "voice" },
]);
const inside = (p: { x: number; y: number }, roomId: string) => {
    const { rect } = layout.rooms.find((r) => r.id === roomId)!;
    return p.x >= rect.x && p.x <= rect.x + rect.width && p.y >= rect.y && p.y <= rect.y + rect.height;
};

describe("placeVoiceFigures", () => {
    it("每個人站在自己語音頻道的房間裡，而且站得住", () => {
        const placed = placeVoiceFigures(layout.rooms, [
            { userId: "1", channelId: "lobby" },
            { userId: "2", channelId: "game" },
            { userId: "3", channelId: "lobby" },
        ]);
        const walkable = createWalkable(layout.map);

        assert.strictEqual(placed.length, 3);
        for (const p of placed) {
            assert.ok(inside(p, p.channelId), `${p.userId} 不在 ${p.channelId} 裡`);
            assert.ok(walkable.canStand(p.x, p.y), `${p.userId} 站在牆上`);
        }
    });

    it("同一個房間的人不會站在同一格", () => {
        const members = Array.from({ length: 12 }, (_, i) => ({ userId: `${i}`, channelId: "lobby" }));
        const placed = placeVoiceFigures(layout.rooms, members);

        assert.strictEqual(new Set(placed.map((p) => `${p.x},${p.y}`)).size, 12);
    });

    it("站位只看 userId，加入的順序不同結果也一樣（畫面不會亂跳）", () => {
        const a = placeVoiceFigures(layout.rooms, [{ userId: "1", channelId: "lobby" }, { userId: "2", channelId: "lobby" }]);
        const b = placeVoiceFigures(layout.rooms, [{ userId: "2", channelId: "lobby" }, { userId: "1", channelId: "lobby" }]);

        const pos = (list: typeof a, id: string) => list.find((p) => p.userId === id)!;
        assert.deepStrictEqual([pos(a, "1").x, pos(a, "1").y], [pos(b, "1").x, pos(b, "1").y]);
    });

    it("頻道不在地圖上（例如私人頻道）的人不放", () => {
        assert.deepStrictEqual(placeVoiceFigures(layout.rooms, [{ userId: "1", channelId: "secret" }]), []);
    });

    it("房間站滿後仍然留在房間裡", () => {
        const members = Array.from({ length: 30 }, (_, i) => ({ userId: `${String(i).padStart(2, "0")}`, channelId: "game" }));
        for (const p of placeVoiceFigures(layout.rooms, members)) assert.ok(inside(p, "game"), p.userId);
    });

    it("房間很矮時也不會站到房間外面", () => {
        const short = [{ id: "tiny", name: "小房間", kind: "voice" as const, rect: { x: 100, y: 100, width: 32, height: 20 } }];
        const placed = placeVoiceFigures(short, [{ userId: "1", channelId: "tiny" }, { userId: "2", channelId: "tiny" }]);
        for (const p of placed) {
            assert.ok(p.x >= 100 && p.x <= 132 && p.y >= 100 && p.y <= 120, JSON.stringify(p));
        }
    });
});
