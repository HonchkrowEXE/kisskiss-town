// 匯出小鎮地圖成 Tiled JSON：管理員可以拿去 Tiled 或 tilemap.dev 改，改完再用「匯入」放回來（ADR-0011 的格式）。
// 純函式；前端會用，不能 import 任何 Node 專用的東西。

import type { TownLayout } from "./layoutTown.js";
import type { TiledLayer, TiledMap, TiledObject } from "./walkable.js";

/** Tiled 存檔時物件上的其他欄位。 */
type FullObject = TiledObject & { rotation: number; visible: boolean };

/** 自動產生的小鎮用的圖塊圖片檔名（前端把 maps/tiles.svg 轉成 PNG 一起下載）。 */
export const AUTO_TILESET_IMAGE = "kisskiss-tiles.png";

/** 匯出的結果：Tiled JSON 和要一起下載的圖片（檔名 → data URL；自動產生的小鎮的圖塊圖片由前端補上，這裡是空字串）。 */
export type ExportedMap = { map: TiledMap & Record<string, unknown>; images: Record<string, string> };

/**
 * 目前的版面變成可以再匯入的 Tiled JSON：
 * - 匯入的自訂地圖：原封不動（本來就有 area 物件和圖片）
 * - 自動產生或 Claude 設計的小鎮：地板一層、房間是 area 物件（channel 屬性是頻道 ID）、出生點、分區名稱是文字物件
 */
export function exportMap(layout: TownLayout): ExportedMap {
    if (layout.images) return { map: structuredClone(layout.map) as ExportedMap["map"], images: { ...layout.images } };

    const { map, rooms, spawn, labels = [] } = layout;
    let nextObjectId = 1;
    // Tiled 自己存檔時會寫的欄位（rotation、visible…）也寫上，Tiled 打開才不會跳警告
    const layers: (Omit<TiledLayer, "objects"> & { objects?: FullObject[] } & Record<string, unknown>)[] = [
        { id: 1, type: "tilelayer", name: "地板", width: map.width, height: map.height, x: 0, y: 0, opacity: 1, visible: true, data: [...map.layers[0].data!] },
        {
            id: 2, type: "objectgroup", name: "房間", x: 0, y: 0, opacity: 1, visible: true,
            objects: rooms.map((r): FullObject => ({
                id: nextObjectId++, name: r.name, class: "area", x: r.rect.x, y: r.rect.y, width: r.rect.width, height: r.rect.height, rotation: 0, visible: true,
                properties: [{ name: "channel", type: "string", value: r.id }],
            })),
        },
        {
            id: 3, type: "objectgroup", name: "Spawn Points", x: 0, y: 0, opacity: 1, visible: true,
            objects: [{ id: nextObjectId++, name: "spawn", x: spawn.x, y: spawn.y, point: true, rotation: 0, visible: true } satisfies FullObject],
        },
        {
            id: 4, type: "objectgroup", name: "分區名稱", x: 0, y: 0, opacity: 1, visible: true,
            objects: labels.map((l): FullObject => ({ id: nextObjectId++, name: l.text, x: l.x, y: l.y, width: 96, height: 12, rotation: 0, visible: true, text: { text: l.text, pixelsize: 8 } })),
        },
    ];
    const exported: ExportedMap["map"] = {
        type: "map", version: "1.10", tiledversion: "1.11.0", orientation: "orthogonal", renderorder: "right-down", infinite: false,
        width: map.width, height: map.height, tilewidth: map.tilewidth, tileheight: map.tileheight,
        nextlayerid: layers.length + 1, nextobjectid: nextObjectId,
        layers,
        tilesets: [
            {
                firstgid: 1, name: "kisskiss-tiles", image: AUTO_TILESET_IMAGE, imagewidth: 4 * map.tilewidth, imageheight: map.tileheight,
                tilewidth: map.tilewidth, tileheight: map.tileheight, columns: 4, tilecount: 4, margin: 0, spacing: 0,
                tiles: map.tilesets[0].tiles?.map((t) => ({ id: t.id, properties: t.properties?.map((p) => ({ ...p, type: "bool" })) })) ?? [],
            },
        ],
    };
    return { map: exported, images: { [AUTO_TILESET_IMAGE]: "" } };
}
