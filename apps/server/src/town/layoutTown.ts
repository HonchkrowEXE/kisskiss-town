// 從頻道清單產生小鎮地圖（ADR-0010）。純函式：同樣的頻道清單和規劃一定產生同樣的地圖。
// 伺服器和前端都會讀它的型別；不能 import 任何 Node 專用的東西。
//
// 版面（單位：格）：
//   ┌──────────────────────────────┐
//   │            廣場（出生點）        │
//   │走  分區名稱                    走│
//   │道  ┌─門─┐ ┌──門──┐ ┌─門─┐     道│
//   │    │房間│ │ 大房間 │ │房間│       │
//   │    └───┘ └──────┘ └───┘       │
//   │            走廊                 │
//   │    分區名稱 ...                  │
// 房間由左到右排，排滿換下一排。一個分區（預設是 Discord 的一個分類）接在同一排後面（隔一格），
// 這一排剩下的位置放不下兩間房才換新的一排；分區名稱寫在它第一間房的上面。
// 房間的門開在上方，面對廣場或走廊；左右兩側的走道把每條走廊接起來。
// 頻道很多時地圖變寬（最寬 MAX_INNER 格），不會變成一條很長的走廊。

import type { TiledMap } from "./walkable.js";

/** category：Discord 的分類名稱；沒有分類就不填。 */
export type TownChannel = { id: string; name: string; kind: "voice" | "text"; category?: string };

/** 地圖上對應一個頻道的房間。id 就是頻道 ID。 */
export type ChannelRoom = TownChannel & {
    /** 房間內部（不含牆）的範圍，像素。 */
    rect: { x: number; y: number; width: number; height: number };
};

/** 地板的樣式（對應前端 tiles.svg 的圖塊）。 */
export const FLOORS = ["carpet", "wood", "tile"] as const;
export type Floor = (typeof FLOORS)[number];
/** 房間大小：連牆的寬 × 高（格）。 */
export const ROOM_SIZES = { small: [7, 5], medium: [8, 6], large: [11, 8] } as const;
export type RoomSize = keyof typeof ROOM_SIZES;

/** 一個分區：名稱（顯示在地圖上，空字串不顯示）、裡面的頻道（ID，照順序）、房間大小、地板（不填就照頻道種類）。 */
export type DistrictPlan = { name: string; channels: string[]; size: RoomSize; floor?: Floor };
/** 請 Claude 設計小鎮時，管理員的描述最多幾個字。 */
export const MAX_PROMPT = 500;

/** 小鎮的規劃：分區照順序由上往下排。自動產生的用 defaultPlan，Claude 設計的存在資料庫。 */
export type TownPlan = { districts: DistrictPlan[] };

/**
 * 小鎮的版面：地圖、房間、出生點、地圖上的文字（分區名稱）。
 * images 只有匯入的自訂地圖才有（圖塊集的檔名 → 圖片）；自動長出來的小鎮用前端內建的 tiles.svg。
 */
export type TownLayout = {
    map: TiledMap;
    rooms: ChannelRoom[];
    spawn: { x: number; y: number };
    images?: Record<string, string>;
    labels?: { text: string; x: number; y: number }[];
};

/** 傳給前端的地圖：版面加上要提示成員的話（例如還讀不到頻道），沒有就是 null。 */
export type TownMapState = TownLayout & { notice: string | null };

/** 圖塊編號，對應前端 maps/tiles.svg 的格子順序（從 1 開始）。 */
export const TILE = { floor: 1, wall: 2, voiceFloor: 3, textFloor: 4 } as const;
const FLOOR_TILE: Record<Floor, number> = { carpet: TILE.floor, wood: TILE.voiceFloor, tile: TILE.textFloor };

const TILE_SIZE = 16;
const PLAZA = 4; // 廣場高度
const CORRIDOR = 3; // 兩排房間之間的走廊高度（分區名稱寫在走廊上）
const WALKWAY = 2; // 左右走道寬度
const MIN_INNER = 32; // 房間區最少幾格寬（頻道少時跟以前一樣一排 4 間）
const MAX_INNER = 190; // 最多幾格寬（加上走道和外牆不超過 200）
const MANY_CHANNELS = 100; // 頻道超過這麼多時預設用小房間，地圖才不會太大

/** 照頻道清單的預設規劃：連續同一個分類的頻道是一區，分區名稱就是分類名稱。 */
export function defaultPlan(channels: TownChannel[]): TownPlan {
    const size: RoomSize = channels.length > MANY_CHANNELS ? "small" : "medium";
    const districts: DistrictPlan[] = [];
    for (const channel of channels) {
        const name = channel.category ?? "";
        const last = districts.at(-1);
        if (last && last.name === name) last.channels.push(channel.id);
        else districts.push({ name, channels: [channel.id], size });
    }
    return { districts };
}

export function layoutTown(channels: TownChannel[], plan: TownPlan = defaultPlan(channels)): TownLayout {
    const byId = new Map(channels.map((c) => [c.id, c]));
    // 規劃裡的頻道照規劃排（已經不在的跳過、重複的只算第一次），規劃沒提到的新頻道放到最後「其他」區
    const used = new Set<string>();
    const districts: { name: string; size: RoomSize; floor?: Floor; channels: TownChannel[] }[] = [];
    for (const d of plan.districts) {
        const list = d.channels.flatMap((id) => (byId.has(id) && !used.has(id) ? (used.add(id), [byId.get(id)!]) : []));
        if (list.length) districts.push({ name: d.name, size: d.size, floor: d.floor, channels: list });
    }
    const rest = channels.filter((c) => !used.has(c.id));
    if (rest.length) districts.push({ name: districts.length ? "其他" : "", size: channels.length > MANY_CHANNELS ? "small" : "medium", channels: rest });

    // 寬度：房間總面積開根號再乘 2（地圖大約是 2:1 的橫長方形），至少能放下最寬的房間
    const area = districts.reduce((sum, d) => sum + d.channels.length * ROOM_SIZES[d.size][0] * (ROOM_SIZES[d.size][1] + CORRIDOR), 0);
    const widest = Math.max(0, ...districts.map((d) => ROOM_SIZES[d.size][0]));
    const inner = Math.max(MIN_INNER, widest, Math.min(MAX_INNER, Math.round(Math.sqrt(area * 2))));
    const left0 = 1 + WALKWAY;

    // 先算每個房間放哪（左上角，格），再一次畫出來
    type Placed = { channel: TownChannel; left: number; top: number; w: number; h: number; floor: number };
    const placed: Placed[] = [];
    const labels: { text: string; x: number; y: number }[] = [];
    let top = 1 + PLAZA;
    let x = 0; // 這一排已經用了幾格
    let rowHeight = 0; // 這一排最高的房間
    const newRow = () => {
        top += rowHeight + CORRIDOR;
        x = 0;
        rowHeight = 0;
    };
    for (const d of districts) {
        const [w, h] = ROOM_SIZES[d.size];
        if (x > 0) {
            x += 1; // 跟前一區隔一格
            if (x + 2 * w > inner) newRow();
        }
        if (d.name) labels.push({ text: d.name, x: (left0 + x) * TILE_SIZE, y: (top - 1) * TILE_SIZE + 2 }); // 寫在第一間房上面的走道
        for (const channel of d.channels) {
            if (x + w > inner) newRow();
            const floor = FLOOR_TILE[d.floor ?? (channel.kind === "voice" ? "wood" : "tile")];
            placed.push({ channel, left: left0 + x, top, w, h, floor });
            x += w;
            rowHeight = Math.max(rowHeight, h);
        }
    }
    const width = left0 + inner + WALKWAY + 1;
    const height = placed.length ? top + rowHeight + 1 : 1 + PLAZA + 1;

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

    const rooms = placed.map(({ channel, left, top, w, h, floor }) => {
        for (let y = top; y < top + h; y++) {
            for (let x = left; x < left + w; x++) {
                const onWall = x === left || x === left + w - 1 || y === top || y === top + h - 1;
                set(x, y, onWall ? TILE.wall : floor);
            }
        }
        // 門：上方的牆正中間兩格
        const doorX = left + Math.floor(w / 2) - 1;
        set(doorX, top, floor);
        set(doorX + 1, top, floor);

        return {
            ...channel,
            rect: { x: (left + 1) * TILE_SIZE, y: (top + 1) * TILE_SIZE, width: (w - 2) * TILE_SIZE, height: (h - 2) * TILE_SIZE },
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

    return labels.length ? { map, rooms, spawn, labels } : { map, rooms, spawn };
}

/** 腳底在 (x, y) 時站在哪個房間裡；在廣場或走廊就是 undefined。 */
export function roomAt(rooms: ChannelRoom[], x: number, y: number): ChannelRoom | undefined {
    return rooms.find((r) => x >= r.rect.x && x < r.rect.x + r.rect.width && y >= r.rect.y && y < r.rect.y + r.rect.height);
}
