// 家具（名詞表：物件）：放在地圖格子上、可以互動的東西。伺服器和前端都會讀；不能 import 任何 Node 專用的東西。
//
// 加一種家具：
//   1. 在 OBJECT_KINDS 加一筆（名稱、大小、擋不擋路、怎麼互動）
//   2. 前端 scene/objectArt.ts 加畫法
//   3. 要特別的互動畫面的話，伺服器 features/Furniture.ts 加處理、前端 ui/ 加面板

import { roomAt, type ChannelRoom, type TownLayout } from "./layoutTown.js";
import type { Walkable } from "./walkable.js";

/** 家具怎麼互動：sit 可以坐、board 打開揪團看板、tv 打開電視、none 只是擺設。 */
export type Interaction = "sit" | "board" | "tv" | "none";

export const OBJECT_KINDS = {
    table: { name: "桌子", width: 2, height: 1, blocks: true, interaction: "none" as Interaction },
    chair: { name: "椅子", width: 1, height: 1, blocks: false, interaction: "sit" as Interaction },
    computer: { name: "電腦", width: 1, height: 1, blocks: true, interaction: "board" as Interaction },
    tv: { name: "電視", width: 2, height: 1, blocks: true, interaction: "tv" as Interaction },
} as const;
export type ObjectKind = keyof typeof OBJECT_KINDS;
export const isObjectKind = (kind: unknown): kind is ObjectKind => typeof kind === "string" && Object.hasOwn(OBJECT_KINDS, kind);

/** 放在地圖上的一件家具。x、y 是左上角的格子座標。 */
export type TownObject = { id: string; kind: ObjectKind; x: number; y: number };

/** 揪團看板上的一則：標題、連結、誰貼的（名字和帳號 ID）、什麼時候。 */
export type BoardPost = { title: string; url: string; by: string; userId: string; at: number };

/** 這件家具佔的每一格（格子編號 = y × 地圖寬 + x）。 */
export function footprint(o: TownObject, mapWidth: number) {
    const { width, height } = OBJECT_KINDS[o.kind];
    const tiles: number[] = [];
    for (let dy = 0; dy < height; dy++) for (let dx = 0; dx < width; dx++) tiles.push((o.y + dy) * mapWidth + o.x + dx);
    return tiles;
}

/** 擋路的家具佔的格子，給碰撞判斷用。 */
export const blockedTiles = (objects: TownObject[], mapWidth: number) =>
    objects.filter((o) => OBJECT_KINDS[o.kind].blocks).flatMap((o) => footprint(o, mapWidth));

/** 家具中心（像素）：互動距離、坐下的位置都從這裡算。 */
export function centerOf(o: TownObject, tile: number) {
    const { width, height } = OBJECT_KINDS[o.kind];
    return { x: (o.x + width / 2) * tile, y: (o.y + height / 2) * tile };
}

/**
 * 家具能不能放在這裡：每一格都在地圖裡、站得住（不是牆），也不跟別的家具重疊。
 * walkable 要用「還沒加上家具」的地圖算，不然會把自己當牆。
 */
export function canPlaceObject(o: TownObject, layout: TownLayout, walkable: Walkable, others: TownObject[]) {
    const { map } = layout;
    const { width, height } = OBJECT_KINDS[o.kind];
    if (o.x < 0 || o.y < 0 || o.x + width > map.width || o.y + height > map.height) return false;
    for (let dy = 0; dy < height; dy++) {
        for (let dx = 0; dx < width; dx++) {
            const cx = (o.x + dx + 0.5) * map.tilewidth;
            const cy = (o.y + dy + 0.5) * map.tileheight;
            if (!walkable.canStand(cx, cy)) return false;
        }
    }
    const mine = new Set(footprint(o, map.width));
    return !others.some((other) => other.id !== o.id && footprint(other, map.width).some((t) => mine.has(t)));
}

/**
 * 預設的家具（管理員還沒用編輯器改過時）：像一個家。
 * - 每個房間中間一張桌子、兩邊各一張椅子
 * - 語音房（客廳）靠上牆放電視；文字房（書房）桌上放電腦
 */
export function defaultFurniture(layout: TownLayout): TownObject[] {
    const tile = layout.map.tilewidth;
    const objects: TownObject[] = [];
    for (const room of layout.rooms) objects.push(...furnishRoom(room, tile));
    return objects;
}

function furnishRoom(room: ChannelRoom, tile: number): TownObject[] {
    const left = room.rect.x / tile;
    const top = room.rect.y / tile;
    const cols = room.rect.width / tile;
    const rows = room.rect.height / tile;
    if (cols < 4 || rows < 3) return [];
    const midX = left + Math.floor(cols / 2) - 1;
    const tableY = top + rows - 2;
    const id = (name: string) => `${room.id}-${name}`;
    const objects: TownObject[] = [
        { id: id("table"), kind: "table", x: midX, y: tableY },
        { id: id("chair-l"), kind: "chair", x: midX - 1, y: tableY },
        { id: id("chair-r"), kind: "chair", x: midX + 2, y: tableY },
    ];
    // 電視、電腦靠房間最上面一排，但避開門口那兩格（房間正中間）
    if (room.kind === "voice") objects.push({ id: id("tv"), kind: "tv", x: left, y: top });
    else objects.push({ id: id("computer"), kind: "computer", x: left + cols - 1, y: top });
    return objects;
}

/** 這件家具在哪個房間（看中心點）。 */
export const roomOfObject = (o: TownObject, layout: TownLayout) => {
    const c = centerOf(o, layout.map.tilewidth);
    return roomAt(layout.rooms, c.x, c.y);
};
