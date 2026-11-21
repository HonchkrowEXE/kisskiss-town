import assert from "assert";
import { findSlapTarget, knockback, KNOCKBACK } from "../src/town/slap.js";
import type { Walkable } from "../src/town/walkable.js";

const at = (userId: string, x: number, y: number) => ({ userId, position: { x, y } });
const open: Walkable = { canStand: () => true, canWalk: () => true };
const walled: Walkable = { canStand: () => true, canWalk: () => false };

describe("搧巴掌判定", () => {
    it("搧到旁邊最近的人", () => {
        const me = at("1", 100, 100);
        const found = findSlapTarget(me, [["far", at("2", 120, 100)], ["near", at("3", 100, 112)], ["me", me]]);
        assert.strictEqual(found?.[0], "near");
    });

    it("太遠的人、自己的其他分頁都搧不到", () => {
        const me = at("1", 100, 100);
        assert.strictEqual(findSlapTarget(me, [["far", at("2", 130, 100)], ["tab2", at("1", 104, 100)]]), undefined);
    });

    it("往遠離搧人者的方向退一格，取差比較多的軸", () => {
        assert.deepStrictEqual(knockback({ x: 100, y: 100 }, { x: 112, y: 104 }, "down", open), { x: 112 + KNOCKBACK, y: 104 });
        assert.deepStrictEqual(knockback({ x: 100, y: 100 }, { x: 98, y: 88 }, "down", open), { x: 98, y: 88 - KNOCKBACK });
    });

    it("站在同一點時往搧人者面向的方向退", () => {
        assert.deepStrictEqual(knockback({ x: 100, y: 100 }, { x: 100, y: 100 }, "left", open), { x: 100 - KNOCKBACK, y: 100 });
    });

    it("後面是牆就原地不動", () => {
        assert.deepStrictEqual(knockback({ x: 100, y: 100 }, { x: 112, y: 100 }, "right", walled), { x: 112, y: 100 });
    });
});
