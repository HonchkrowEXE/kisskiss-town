// 伺服器和前端共用：前端用它預判撞牆，伺服器用它驗證位置。不能 import 任何 Node 專用的東西。

/** 走路速度（每秒幾個像素）。 */
export const SPEED = 80;

/** 角色的碰撞框：以腳底為中心、邊長 8px 的正方形。 */
const COLLIDER_HALF = 4;

/** Tiled JSON 裡算碰撞需要的欄位。 */
export type TiledMap = {
    width: number;
    height: number;
    tilewidth: number;
    tileheight: number;
    layers: { type: string; data?: number[] }[];
    tilesets: {
        firstgid: number;
        tiles?: { id: number; properties?: { name: string; value: unknown }[] }[];
    }[];
};

export type Walkable = {
    /** 角色腳底站在 (x, y) 時，碰撞框有沒有碰到牆或超出地圖。 */
    canStand(x: number, y: number): boolean;
    /** 從 from 直線走到 to，整條路上都沒碰到牆（不能隔著牆跳過去）。 */
    canWalk(from: { x: number; y: number }, to: { x: number; y: number }): boolean;
    /** 隨機挑一格可以站的圖塊，回傳它的中心點。 */
    randomSpawn(random?: () => number): { x: number; y: number };
};

/**
 * 從 Tiled 地圖算出哪些格子不能走：圖塊集裡標了 `collides: true` 的圖塊就是牆。
 * ponytail: tilemap.dev 不能加自訂屬性（ADR-0006），它匯出的地圖會沒有牆；#5 匯入地圖時要決定碰撞怎麼標。
 */
export function createWalkable(map: TiledMap): Walkable {
    const blockedGids = new Set<number>();
    for (const tileset of map.tilesets) {
        for (const tile of tileset.tiles ?? []) {
            if (tile.properties?.some((p) => p.name === "collides" && p.value === true)) {
                blockedGids.add(tileset.firstgid + tile.id);
            }
        }
    }

    // 任何一個圖塊層在這格放了牆，這格就不能走
    const blocked = new Array<boolean>(map.width * map.height).fill(false);
    for (const layer of map.layers) {
        if (layer.type !== "tilelayer" || !layer.data) continue;
        layer.data.forEach((gid, i) => {
            if (blockedGids.has(gid)) blocked[i] = true;
        });
    }

    const isBlockedTile = (tx: number, ty: number) =>
        tx < 0 || ty < 0 || tx >= map.width || ty >= map.height || blocked[ty * map.width + tx];

    function canStand(x: number, y: number) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
        // 碰撞框右、下邊界剛好壓在格線上時不算碰到下一格
        const left = Math.floor((x - COLLIDER_HALF) / map.tilewidth);
        const right = Math.floor((x + COLLIDER_HALF - 1e-6) / map.tilewidth);
        const top = Math.floor((y - COLLIDER_HALF) / map.tileheight);
        const bottom = Math.floor((y + COLLIDER_HALF - 1e-6) / map.tileheight);
        for (let ty = top; ty <= bottom; ty++) {
            for (let tx = left; tx <= right; tx++) {
                if (isBlockedTile(tx, ty)) return false;
            }
        }
        return true;
    }

    const open: number[] = [];
    blocked.forEach((b, i) => !b && open.push(i));

    function randomSpawn(random = Math.random) {
        if (open.length === 0) throw new Error("地圖上沒有可以站的格子");
        const i = open[Math.floor(random() * open.length)];
        return {
            x: (i % map.width) * map.tilewidth + map.tilewidth / 2,
            y: Math.floor(i / map.width) * map.tileheight + map.tileheight / 2,
        };
    }

    function canWalk(from: { x: number; y: number }, to: { x: number; y: number }) {
        if (!canStand(to.x, to.y)) return false;
        // 每隔不到碰撞框邊長檢查一次，相鄰兩次的框會重疊，中間不會漏掉任何一格牆
        const steps = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / COLLIDER_HALF);
        for (let i = 1; i < steps; i++) {
            const t = i / steps;
            if (!canStand(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t)) return false;
        }
        return true;
    }

    return { canStand, canWalk, randomSpawn };
}
