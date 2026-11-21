// 匯入自訂地圖（ADR-0006、ADR-0011）：管理員上傳 tilemap.dev 或 Tiled 匯出的 Tiled JSON 和圖塊圖片，
// 覆蓋自動長出來的小鎮。純函式；伺服器和前端都會讀型別，不能 import 任何 Node 專用的東西。

import type { ChannelRoom, TownChannel, TownLayout } from "./layoutTown.js";
import type { TiledLayer, TiledMap, TiledObject, TiledProperty } from "./walkable.js";

/** 圖塊圖片：檔名 → data URL（data:image/png;base64,…）。 */
export type MapImages = Record<string, string>;

/** 存起來的自訂地圖：Tiled JSON（圖塊集的 image 換成檔名）和用到的圖片。 */
export type StoredMap = { map: TiledMap & Record<string, unknown>; images: MapImages };

/** 上傳的地圖有問題。訊息可以直接給管理員看。 */
export class MapImportError extends Error {}

/** 地圖最大幾格（寬 × 高），太大前端畫不動、同步也慢。 */
const MAX_TILES = 200 * 200;

const IMAGE_DATA_URL = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/** 路徑只留檔名（Tiled 存的是相對路徑，例如 ../tiles/town.png）。 */
const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** 檢查上傳的地圖，回傳要存起來的樣子；有問題丟 MapImportError。 */
export function validateImport(input: unknown, images: unknown): StoredMap {
    if (typeof input !== "object" || input === null) throw new MapImportError("地圖檔不是 Tiled JSON，請在 tilemap.dev 或 Tiled 匯出成 JSON");
    const map = structuredClone(input) as TiledMap & Record<string, unknown>;
    const positive = (n: unknown) => Number.isInteger(n) && (n as number) > 0;
    if (![map.width, map.height, map.tilewidth, map.tileheight].every(positive)) throw new MapImportError("地圖檔缺少寬、高或圖塊大小，請確認是 Tiled JSON");
    if (map.orientation !== undefined && map.orientation !== "orthogonal") throw new MapImportError("只支援方形格子（orthogonal）的地圖");
    if (map.infinite === true) throw new MapImportError("不支援無限地圖，請在 Tiled 的地圖屬性取消 Infinite 再匯出");
    if (map.width * map.height > MAX_TILES) throw new MapImportError("地圖太大了，最多 200 × 200 格");
    if (!Array.isArray(map.layers) || !Array.isArray(map.tilesets)) throw new MapImportError("地圖檔缺少圖層或圖塊集");

    // 補上 Tiled 的標準欄位：tilemap.dev 有時省略，前端 Phaser 讀 Tiled JSON 時需要
    Object.assign(map, { orientation: "orthogonal", renderorder: map.renderorder ?? "right-down", infinite: false });
    map.layers.forEach((layer, i) => {
        Object.assign(layer, { name: layer.name ?? `layer-${i}`, x: 0, y: 0, opacity: (layer as { opacity?: number }).opacity ?? 1, visible: layer.visible ?? true });
        if (layer.type !== "tilelayer") return;
        Object.assign(layer, { width: map.width, height: map.height });
        if (!Array.isArray(layer.data) || layer.data.length !== map.width * map.height || !layer.data.every((g) => Number.isInteger(g))) {
            throw new MapImportError(`圖層「${layer.name}」的格式不支援，請把圖塊層格式設成 CSV 再匯出`);
        }
    });
    map.tilesets.forEach((tileset, i) => (tileset.name ??= `tileset-${i}`));

    const provided = typeof images === "object" && images !== null ? (images as Record<string, unknown>) : {};
    const used: MapImages = {};
    for (const tileset of map.tilesets) {
        if ("source" in tileset) throw new MapImportError("不支援外部圖塊集，請在 Tiled 匯出時勾選「Embed tilesets」");
        if (!tileset.image) throw new MapImportError(`圖塊集「${tileset.name ?? ""}」沒有圖片（不支援一張圖一格的圖塊集）`);
        const name = fileName(tileset.image);
        const data = provided[name];
        if (typeof data !== "string") throw new MapImportError(`缺少圖塊圖片：${name}，請一起選這張圖`);
        if (!IMAGE_DATA_URL.test(data)) throw new MapImportError(`圖塊圖片 ${name} 不是 PNG、JPEG、GIF 或 WebP`);
        tileset.image = name;
        used[name] = data;
    }
    return { map, images: used };
}

const prop = (properties: TiledProperty[] | undefined, name: string) => properties?.find((p) => p.name === name)?.value;
const kindOf = (o: TiledObject) => (o.class ?? o.type ?? "").toLowerCase();
const objects = (map: TiledMap) => map.layers.flatMap((l: TiledLayer) => (l.type === "objectgroup" ? (l.objects ?? []).map((o) => ({ o, layer: l })) : []));

/**
 * 自訂地圖變成小鎮的版面：
 * - 房間：class（或 type）是 area、有 channel 屬性（頻道 ID 或名稱）的矩形物件；頻道不在清單裡（例如私人頻道）就不算
 * - 出生點：Spawn Points 群組裡的物件，或名稱、class 是 spawn 的物件；都沒有就用地圖中央
 */
export function importedLayout(stored: StoredMap, channels: TownChannel[]): TownLayout {
    const { map, images } = stored;
    const all = objects(map);

    const rooms: ChannelRoom[] = [];
    for (const { o } of all) {
        if (kindOf(o) !== "area" || !o.width || !o.height) continue;
        const channel = prop(o.properties, "channel");
        const match = channels.find((c) => c.id === channel || c.name === channel);
        if (match && !rooms.some((r) => r.id === match.id)) rooms.push({ ...match, rect: { x: o.x, y: o.y, width: o.width, height: o.height } });
    }

    const spawnObject = all.find(({ o, layer }) => /spawn/i.test(layer.name ?? "") || /^spawn/i.test(o.name ?? "") || kindOf(o).startsWith("spawn"))?.o;
    const spawn = spawnObject
        ? { x: spawnObject.x + (spawnObject.width ?? 0) / 2, y: spawnObject.y + (spawnObject.height ?? 0) / 2 }
        : { x: (map.width * map.tilewidth) / 2, y: (map.height * map.tileheight) / 2 };

    return { map, rooms, spawn, images };
}
