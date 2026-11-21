import assert from "assert";
import { createWalkable, type TiledMap } from "../src/town/walkable.js";

// 4×3 的小地圖，每格 16px：外圈是牆（gid 2），中間兩格是地板（gid 1）
//   牆 牆 牆 牆
//   牆 地 地 牆
//   牆 牆 牆 牆
const map: TiledMap = {
    width: 4,
    height: 3,
    tilewidth: 16,
    tileheight: 16,
    layers: [{ type: "tilelayer", data: [2, 2, 2, 2, 2, 1, 1, 2, 2, 2, 2, 2] }],
    tilesets: [{ firstgid: 1, tiles: [{ id: 1, properties: [{ name: "collides", value: true }] }] }],
};
const walk = createWalkable(map);

describe("createWalkable", () => {
    it("地板中央可以站", () => {
        assert.ok(walk.canStand(24, 24));
        assert.ok(walk.canStand(40, 24));
    });

    it("站在牆上不行", () => {
        assert.ok(!walk.canStand(8, 8));
    });

    it("碰撞框有一部分壓到牆就不行", () => {
        assert.ok(!walk.canStand(19, 24)); // 框的左邊到 15，壓到左邊的牆
        assert.ok(walk.canStand(20, 24)); // 框的左邊剛好到 16，沒壓到
    });

    it("跨兩格地板之間可以站", () => {
        assert.ok(walk.canStand(32, 24));
    });

    it("超出地圖不行", () => {
        assert.ok(!walk.canStand(-100, 24));
        assert.ok(!walk.canStand(24, 1000));
    });

    it("不是數字的座標不行", () => {
        assert.ok(!walk.canStand(NaN, 24));
        assert.ok(!walk.canStand(Infinity, 24));
    });

    it("出生點一定在可以站的格子中央", () => {
        for (const r of [0, 0.3, 0.6, 0.999]) {
            const spawn = walk.randomSpawn(() => r);
            assert.ok(walk.canStand(spawn.x, spawn.y), `random=${r} 生在 (${spawn.x}, ${spawn.y})`);
        }
    });
});

describe("canWalk", () => {
    // 3×1：地 牆 地
    const thin = createWalkable({
        width: 3, height: 1, tilewidth: 16, tileheight: 16,
        layers: [{ type: "tilelayer", data: [1, 2, 1] }],
        tilesets: [{ firstgid: 1, tiles: [{ id: 1, properties: [{ name: "collides", value: true }] }] }],
    });

    it("同一格地板裡走動可以", () => {
        assert.ok(walk.canWalk({ x: 24, y: 24 }, { x: 40, y: 24 }));
    });

    it("終點和起點都站得住，但中間隔著牆就不行", () => {
        assert.ok(thin.canStand(8, 8) && thin.canStand(40, 8));
        assert.ok(!thin.canWalk({ x: 8, y: 8 }, { x: 40, y: 8 }));
    });

    it("原地不動可以", () => {
        assert.ok(walk.canWalk({ x: 24, y: 24 }, { x: 24, y: 24 }));
    });
});
