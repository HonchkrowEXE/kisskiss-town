import assert from "assert";
import { findPath } from "../src/town/path.js";
import { createWalkable, type TiledMap } from "../src/town/walkable.js";

// 5×5、每格 16px，# 是牆：
//   # # # # #
//   # . . . #
//   # # # . #
//   # . . . #
//   # # # # #
const rows = ["#####", "#...#", "###.#", "#...#", "#####"];
const map: TiledMap = {
    width: 5,
    height: 5,
    tilewidth: 16,
    tileheight: 16,
    layers: [{ type: "tilelayer", data: rows.join("").split("").map((c) => (c === "#" ? 2 : 1)) }],
    tilesets: [{ firstgid: 1, tiles: [{ id: 1, properties: [{ name: "collides", value: true }] }] }],
};
const walkable = createWalkable(map);
const at = (tx: number, ty: number) => ({ x: tx * 16 + 8, y: ty * 16 + 8 });

describe("findPath", () => {
    it("繞過牆走到點的位置，每一段都不穿牆", () => {
        const from = at(1, 1);
        const path = findPath(walkable, map, from, { x: 20, y: 54 })!;
        assert.deepStrictEqual(path.at(-1), { x: 20, y: 54 });
        let prev = from;
        for (const p of path) {
            assert.ok(walkable.canWalk(prev, p), `${JSON.stringify(prev)} → ${JSON.stringify(p)} 穿牆`);
            prev = p;
        }
    });

    it("一路看得到就直接走過去，不繞一格一格", () => {
        assert.deepStrictEqual(findPath(walkable, map, at(1, 1), at(3, 1)), [at(3, 1)]);
    });

    it("點到牆，走到牆旁邊能站的格子", () => {
        const path = findPath(walkable, map, at(1, 1), at(2, 2))!;
        const end = path.at(-1)!;
        assert.ok(walkable.canStand(end.x, end.y));
        assert.ok(Math.abs(Math.floor(end.x / 16) - 2) <= 1 && Math.abs(Math.floor(end.y / 16) - 2) <= 1);
    });

    it("被牆圍住或點到地圖外面就走不到", () => {
        assert.strictEqual(findPath(walkable, map, at(1, 1), { x: -10, y: 8 }), undefined);
        const closed = createWalkable(map, [2 * 5 + 3]); // 把唯一的通道堵住
        assert.strictEqual(findPath(closed, map, at(1, 1), at(1, 3)), undefined);
    });
});
