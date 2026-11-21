// 從頻道清單產生小鎮地圖（ADR-0010）。純函式：同樣的頻道清單一定產生同樣的地圖。
// 伺服器和前端都會讀它的型別；不能 import 任何 Node 專用的東西。
//
// 版面（單位：格）：
//   ┌──────────────────────────────┐
//   │            廣場（出生點）        │
//   │走  ┌─門─┐ ┌─門─┐ ┌─門─┐ ┌─門─┐  走│
//   │道  │房間│ │房間│ │房間│ │房間│  道│
//   │    └───┘ └───┘ └───┘ └───┘    │
//   │            走廊                 │
//   │    ┌─門─┐ ...                  │
// 房間的門開在上方，面對廣場或走廊；左右兩側的走道把每條走廊接起來。

import type { TiledMap } from "./walkable.js";

export type TownChannel = { id: string; name: string; kind: "voice" | "text" };

/** 地圖上對應一個頻道的房間。id 就是頻道 ID。 */
export type ChannelRoom = TownChannel & {
    /** 房間內部（不含牆）的範圍，像素。 */
    rect: { x: number; y: number; width: number; height: number };
};

/** 遊戲桌：桌子中心和每個座位（成員入座時站的位置），像素。 */
export type TableSpot = { id: string; x: number; y: number; seats: { x: number; y: number }[] };

export type TownLayout = { map: TiledMap; rooms: ChannelRoom[]; spawn: { x: number; y: number }; tables: TableSpot[] };

/** 傳給前端的地圖：版面加上要提示成員的話（例如還讀不到頻道），沒有就是 null。 */
export type TownMapState = TownLayout & { notice: string | null };

/** 圖塊編號，對應前端 maps/tiles.svg 的格子順序（從 1 開始）。 */
export const TILE = { floor: 1, wall: 2, voiceFloor: 3, textFloor: 4 } as const;

const TILE_SIZE = 16;
const ROOM_W = 8; // 房間連牆的寬
const ROOM_H = 6; // 房間連牆的高
const PER_ROW = 4;
const PLAZA = 4; // 廣場高度
const CORRIDOR = 3; // 兩排房間之間的走廊高度
const WALKWAY = 2; // 左右走道寬度

/** 座位相對桌子中心的位置：上下各一、左右各二，共 6 個。 */
const SEAT_OFFSETS = [[-20, -12], [0, -20], [20, -12], [20, 12], [0, 20], [-20, 12]];

export function layoutTown(channels: TownChannel[]): TownLayout {
    const rows = Math.ceil(channels.length / PER_ROW);
    const width = 1 + WALKWAY + PER_ROW * ROOM_W + WALKWAY + 1;
    const height = 1 + PLAZA + rows * ROOM_H + Math.max(0, rows - 1) * CORRIDOR + 1;

    const data = new Array<number>(width * height).fill(TILE.floor);
    const set = (x: number, y: number, tile: number) => (data[y * width + x] = tile);

    // 外圍的牆
    for (let x = 0; x < width; x++) {
        set(x, 0, TILE.wall);
        set(x, height - 1, TILE.wall);
    }
    for (let y = 0; y < height; y++) {
        set(0, y, TILE.wall);
        set(width - 1, y, TILE.wall);
    }

    const rooms = channels.map((channel, i) => {
        const left = 1 + WALKWAY + (i % PER_ROW) * ROOM_W;
        const top = 1 + PLAZA + Math.floor(i / PER_ROW) * (ROOM_H + CORRIDOR);
        const floor = channel.kind === "voice" ? TILE.voiceFloor : TILE.textFloor;

        for (let y = top; y < top + ROOM_H; y++) {
            for (let x = left; x < left + ROOM_W; x++) {
                const onWall = x === left || x === left + ROOM_W - 1 || y === top || y === top + ROOM_H - 1;
                set(x, y, onWall ? TILE.wall : floor);
            }
        }
        // 門：上方的牆正中間兩格
        const doorX = left + ROOM_W / 2 - 1;
        set(doorX, top, floor);
        set(doorX + 1, top, floor);

        return {
            ...channel,
            rect: {
                x: (left + 1) * TILE_SIZE,
                y: (top + 1) * TILE_SIZE,
                width: (ROOM_W - 2) * TILE_SIZE,
                height: (ROOM_H - 2) * TILE_SIZE,
            },
        };
    });

    const map: TiledMap = {
        width,
        height,
        tilewidth: TILE_SIZE,
        tileheight: TILE_SIZE,
        layers: [{ type: "tilelayer", data }],
        tilesets: [{ firstgid: 1, tiles: [{ id: TILE.wall - 1, properties: [{ name: "collides", value: true }] }] }],
    };

    // 出生點在廣場正中央的格子中心
    const spawn = {
        x: Math.floor(width / 2) * TILE_SIZE + TILE_SIZE / 2,
        y: (1 + Math.floor(PLAZA / 2)) * TILE_SIZE + TILE_SIZE / 2,
    };

    // ponytail: 遊戲桌先固定放在廣場左右兩側；之後管理員的編輯模式（#14）或匯入地圖（#5）再讓人自己擺
    const tableY = (1 + PLAZA / 2) * TILE_SIZE;
    const tables = [6, width - 6].map((tileX, i) => {
        const x = tileX * TILE_SIZE;
        return { id: `table-${i + 1}`, x, y: tableY, seats: SEAT_OFFSETS.map(([dx, dy]) => ({ x: x + dx, y: tableY + dy })) };
    });

    return { map, rooms, spawn, tables };
}

/** 腳底在 (x, y) 時站在哪個房間裡；在廣場或走廊就是 undefined。 */
export function roomAt(rooms: ChannelRoom[], x: number, y: number): ChannelRoom | undefined {
    return rooms.find((r) => x >= r.rect.x && x < r.rect.x + r.rect.width && y >= r.rect.y && y < r.rect.y + r.rect.height);
}
