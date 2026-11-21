import assert from "assert";
import { layoutTown, roomAt, TILE, type TownChannel } from "../src/town/layoutTown.js";
import { createWalkable } from "../src/town/walkable.js";

const channel = (id: string, kind: "voice" | "text" = "voice"): TownChannel => ({ id, name: `頻道${id}`, kind });
const channels = (n: number) => Array.from({ length: n }, (_, i) => channel(`${i}`, i % 2 ? "text" : "voice"));

/** 從出生點走得到的所有格子（只走地板，上下左右）。 */
function reachable(layout: ReturnType<typeof layoutTown>) {
    const { width, height, tilewidth } = layout.map;
    const data = layout.map.layers[0].data!;
    const start = [Math.floor(layout.spawn.x / tilewidth), Math.floor(layout.spawn.y / tilewidth)];
    const seen = new Set<number>([start[1] * width + start[0]]);
    const queue = [start];
    while (queue.length) {
        const [x, y] = queue.pop()!;
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
            const i = ny * width + nx;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height || seen.has(i) || data[i] === TILE.wall) continue;
            seen.add(i);
            queue.push([nx, ny]);
        }
    }
    return seen;
}

describe("layoutTown", () => {
    it("沒有頻道時只有一塊廣場，出生點站得住，四周是牆", () => {
        const layout = layoutTown([]);
        const { width, height } = layout.map;
        const data = layout.map.layers[0].data!;

        assert.deepStrictEqual(layout.rooms, []);
        assert.ok(createWalkable(layout.map).canStand(layout.spawn.x, layout.spawn.y));
        for (let x = 0; x < width; x++) {
            assert.strictEqual(data[x], TILE.wall);
            assert.strictEqual(data[(height - 1) * width + x], TILE.wall);
        }
    });

    it("每個頻道一個房間，順序和名稱照輸入", () => {
        const input = channels(6);
        const layout = layoutTown(input);

        assert.deepStrictEqual(
            layout.rooms.map((r) => [r.id, r.name, r.kind]),
            input.map((c) => [c.id, c.name, c.kind]),
        );
    });

    it("語音房和文字房的地板不一樣", () => {
        const layout = layoutTown([channel("v", "voice"), channel("t", "text")]);
        const { width, tilewidth } = layout.map;
        const data = layout.map.layers[0].data!;
        const floorOf = (room: (typeof layout.rooms)[number]) =>
            data[Math.floor(room.rect.y / tilewidth) * width + Math.floor(room.rect.x / tilewidth)];

        assert.strictEqual(floorOf(layout.rooms[0]), TILE.voiceFloor);
        assert.strictEqual(floorOf(layout.rooms[1]), TILE.textFloor);
    });

    it("從出生點走得進每一個房間", () => {
        for (const n of [1, 4, 5, 13]) {
            const layout = layoutTown(channels(n));
            const seen = reachable(layout);
            const { width, tilewidth } = layout.map;
            for (const room of layout.rooms) {
                const cx = Math.floor((room.rect.x + room.rect.width / 2) / tilewidth);
                const cy = Math.floor((room.rect.y + room.rect.height / 2) / tilewidth);
                assert.ok(seen.has(cy * width + cx), `${n} 個頻道時走不進 ${room.name}`);
            }
        }
    });

    it("房間只能從門進出：牆上只有門那兩格是空的", () => {
        const layout = layoutTown(channels(1));
        const [room] = layout.rooms;
        const { width, tilewidth } = layout.map;
        const data = layout.map.layers[0].data!;
        // 房間內部往外一圈就是牆
        const left = room.rect.x / tilewidth - 1;
        const top = room.rect.y / tilewidth - 1;
        const right = (room.rect.x + room.rect.width) / tilewidth;
        const bottom = (room.rect.y + room.rect.height) / tilewidth;
        const openings: number[][] = [];
        for (let x = left; x <= right; x++) {
            for (const y of [top, bottom]) if (data[y * width + x] !== TILE.wall) openings.push([x, y]);
        }
        for (let y = top + 1; y < bottom; y++) {
            for (const x of [left, right]) if (data[y * width + x] !== TILE.wall) openings.push([x, y]);
        }

        assert.strictEqual(openings.length, 2, JSON.stringify(openings));
        assert.ok(openings.every(([, y]) => y === top), "門在房間上方");
    });

    it("頻道很多時地圖變大，但每個房間都不重疊", () => {
        const layout = layoutTown(channels(13));
        const rects = layout.rooms.map((r) => r.rect);
        for (let i = 0; i < rects.length; i++) {
            for (let j = i + 1; j < rects.length; j++) {
                const a = rects[i], b = rects[j];
                const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
                assert.ok(!overlap, `${i} 和 ${j} 重疊`);
            }
        }
    });
});

describe("遊戲桌的位置", () => {
    it("每個座位都站得住、在廣場上（不在房間裡），不管頻道多少", () => {
        for (const n of [0, 8, 20]) {
            const channels = Array.from({ length: n }, (_, i) => ({ id: `c${i}`, name: `${i}`, kind: "voice" as const }));
            const layout = layoutTown(channels);
            const walkable = createWalkable(layout.map);
            assert.ok(layout.tables.length > 0);
            for (const table of layout.tables) {
                for (const seat of table.seats) {
                    assert.ok(walkable.canStand(seat.x, seat.y), `${n} 個頻道時 ${table.id} 的座位 ${JSON.stringify(seat)} 站不住`);
                    assert.strictEqual(roomAt(layout.rooms, seat.x, seat.y), undefined);
                }
            }
        }
    });
});

describe("roomAt", () => {
    const layout = layoutTown(channels(5));

    it("站在房間裡回傳那個房間", () => {
        const room = layout.rooms[3];
        assert.strictEqual(roomAt(layout.rooms, room.rect.x + 1, room.rect.y + 1)?.id, room.id);
    });

    it("站在廣場或門口（還沒進房間）回傳 undefined", () => {
        const room = layout.rooms[0];
        assert.strictEqual(roomAt(layout.rooms, layout.spawn.x, layout.spawn.y), undefined);
        assert.strictEqual(roomAt(layout.rooms, room.rect.x + room.rect.width / 2, room.rect.y - 8), undefined);
    });
});
