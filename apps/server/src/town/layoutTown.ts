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

export type TownRoom = TownChannel & {
    channelId: string;
    /** 房間內部（不含牆）的範圍，像素。 */
    rect: { x: number; y: number; width: number; height: number };
};

export type TownLayout = { map: TiledMap; rooms: TownRoom[]; spawn: { x: number; y: number } };

/** 傳給前端的地圖：版面加上「bot 有沒有在這個伺服器」。 */
export type TownMapState = TownLayout & { botMissing: boolean };

/** 圖塊編號，對應前端 maps/tiles.svg 的格子順序（從 1 開始）。 */
export const TILE = { floor: 1, wall: 2, voiceFloor: 3, textFloor: 4 } as const;

const TILE_SIZE = 16;
const ROOM_W = 8; // 房間連牆的寬
const ROOM_H = 6; // 房間連牆的高
const PER_ROW = 4;
const PLAZA = 4; // 廣場高度
const CORRIDOR = 3; // 兩排房間之間的走廊高度
const WALKWAY = 2; // 左右走道寬度

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
            channelId: channel.id,
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

    return { map, rooms, spawn };
}
