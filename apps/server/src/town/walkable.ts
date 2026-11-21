// 伺服器和前端共用：前端用它預判撞牆，伺服器用它驗證位置。不能 import 任何 Node 專用的東西。

/** 走路速度（每秒幾個像素）。 */
export const SPEED = 80;

/** 角色的碰撞框：以腳底為中心、邊長 8px 的正方形。 */
const COLLIDER_HALF = 4;

/** Tiled 的自訂屬性。 */
export type TiledProperty = { name: string; type?: string; value: unknown };

/** Tiled 物件層裡的物件（矩形或點），座標是像素。 */
export type TiledObject = {
    id?: number;
    name?: string;
    type?: string;
    class?: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
    point?: boolean;
    properties?: TiledProperty[];
};

/** Tiled 的圖層：圖塊層（data）或物件層（objects）。 */
export type TiledLayer = {
    type: string;
    name?: string;
    visible?: boolean;
    data?: number[];
    objects?: TiledObject[];
    properties?: TiledProperty[];
};

/** Tiled JSON 裡算碰撞與畫圖需要的欄位。 */
export type TiledMap = {
    width: number;
    height: number;
    tilewidth: number;
    tileheight: number;
    layers: TiledLayer[];
    tilesets: {
        firstgid: number;
        name?: string;
        image?: string;
        imagewidth?: number;
        imageheight?: number;
        tilewidth?: number;
        tileheight?: number;
        columns?: number;
        tilecount?: number;
        margin?: number;
        spacing?: number;
        tiles?: { id: number; properties?: TiledProperty[] }[];
    }[];
};

const isTrue = (properties: TiledProperty[] | undefined, name: string) => properties?.some((p) => p.name === name && p.value === true) ?? false;

/** 整層都是牆的圖塊層：tilemap.dev 的 Collision 圖層，或有 `collidable: true` 屬性的圖層。 */
export const isCollisionLayer = (layer: TiledLayer) =>
    layer.type === "tilelayer" && (/^collisions?$/i.test(layer.name ?? "") || isTrue(layer.properties, "collidable"));

/** 每個矩形都是牆的物件層：tilemap.dev 的 Colliders 群組，或有 `collidable: true` 屬性的物件層。 */
export const isColliderGroup = (layer: TiledLayer) =>
    layer.type === "objectgroup" && (/^colliders?$/i.test(layer.name ?? "") || isTrue(layer.properties, "collidable"));

export type Walkable = {
    /** 角色腳底站在 (x, y) 時，碰撞框有沒有碰到牆或超出地圖。 */
    canStand(x: number, y: number): boolean;
    /** 從 from 直線走到 to，整條路上都沒碰到牆（不能隔著牆跳過去）。 */
    canWalk(from: { x: number; y: number }, to: { x: number; y: number }): boolean;
};

/**
 * 從 Tiled 地圖算出哪些格子不能走（ADR-0011）。這幾種都算牆：
 * - 圖塊集裡標了 `collides: true` 的圖塊（Tiled 的慣例，自動長出來的小鎮也用這個）
 * - Collision 圖層、或有 `collidable: true` 屬性的圖塊層上，有放圖塊的格子（tilemap.dev）
 * - Colliders 物件群組、或有 `collidable: true` 屬性的物件層裡，矩形蓋到的格子（tilemap.dev）
 */
export function createWalkable(map: TiledMap): Walkable {
    const blockedGids = new Set<number>();
    for (const tileset of map.tilesets) {
        for (const tile of tileset.tiles ?? []) {
            if (isTrue(tile.properties, "collides")) blockedGids.add(tileset.firstgid + tile.id);
        }
    }

    // 任何一層在這格放了牆，這格就不能走
    const blocked = new Array<boolean>(map.width * map.height).fill(false);
    for (const layer of map.layers) {
        if (layer.type === "tilelayer" && layer.data) {
            const wholeLayer = isCollisionLayer(layer);
            layer.data.forEach((gid, i) => {
                if (wholeLayer ? gid !== 0 : blockedGids.has(gid)) blocked[i] = true;
            });
        }
        if (isColliderGroup(layer)) {
            for (const o of layer.objects ?? []) {
                if (!o.width || !o.height) continue; // 點或沒有大小的物件不算牆
                const left = Math.floor(o.x / map.tilewidth);
                const right = Math.ceil((o.x + o.width) / map.tilewidth) - 1;
                const top = Math.floor(o.y / map.tileheight);
                const bottom = Math.ceil((o.y + o.height) / map.tileheight) - 1;
                for (let ty = Math.max(0, top); ty <= Math.min(map.height - 1, bottom); ty++) {
                    for (let tx = Math.max(0, left); tx <= Math.min(map.width - 1, right); tx++) blocked[ty * map.width + tx] = true;
                }
            }
        }
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

    return { canStand, canWalk };
}
