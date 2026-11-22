// 伺服器和前端共用（目前只有前端用：點地圖走過去）。不能 import 任何 Node 專用的東西。
import type { Walkable } from "./walkable.js";

type Point = { x: number; y: number };
type Grid = { width: number; height: number; tilewidth: number; tileheight: number };

/**
 * 從 from 走到 to 要經過的點（不含起點）；走不到回傳 undefined。
 * - 以格子為單位找最短路（上下左右四個方向），再把看得到的轉角拉直，走起來不會一格一格轉
 * - to 那格是牆或家具（例如點了桌子）時，走到它旁邊能站的格子
 * ponytail: 每次點擊做一次整張地圖的廣度優先搜尋，地圖幾千格以內很快；地圖變很大再換 A*。
 */
export function findPath(walkable: Walkable, grid: Grid, from: Point, to: Point): Point[] | undefined {
    const { width, height, tilewidth: tw, tileheight: th } = grid;
    const tileOf = (p: Point) => ({ x: Math.floor(p.x / tw), y: Math.floor(p.y / th) });
    const center = (i: number) => ({ x: (i % width) * tw + tw / 2, y: Math.floor(i / width) * th + th / 2 });
    const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height;
    const open = (x: number, y: number) => inside(x, y) && walkable.canStand(x * tw + tw / 2, y * th + th / 2);

    const start = tileOf(from);
    const target = tileOf(to);
    if (!inside(start.x, start.y) || !inside(target.x, target.y)) return undefined;
    // 終點：點的那格能站就是那格，不能站就是它周圍八格裡能站的
    const goals = new Set<number>();
    if (open(target.x, target.y)) goals.add(target.y * width + target.x);
    else {
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (open(target.x + dx, target.y + dy)) goals.add((target.y + dy) * width + target.x + dx);
    }
    if (goals.size === 0) return undefined;

    const startIndex = start.y * width + start.x;
    const cameFrom = new Map<number, number>([[startIndex, -1]]);
    const queue = [startIndex];
    let reached: number | undefined;
    for (let head = 0; head < queue.length; head++) {
        const i = queue[head];
        if (goals.has(i)) {
            reached = i;
            break;
        }
        const x = i % width;
        const y = Math.floor(i / width);
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
            const n = ny * width + nx;
            if (!cameFrom.has(n) && open(nx, ny)) {
                cameFrom.set(n, i);
                queue.push(n);
            }
        }
    }
    if (reached === undefined) return undefined;

    // 格子中心串成路；點的那格能站就停在點的位置，不然停在格子中心
    const tiles: Point[] = [];
    for (let i = reached; i !== startIndex; i = cameFrom.get(i)!) tiles.unshift(center(i));
    const last = goals.has(target.y * width + target.x) && walkable.canStand(to.x, to.y) ? { x: to.x, y: to.y } : center(reached);
    if (tiles.length) tiles[tiles.length - 1] = last;
    else tiles.push(last);

    // 拉直：從現在的位置，直接走到最遠一個中間沒擋住的點
    const path: Point[] = [];
    let at = from;
    for (let i = 0; i < tiles.length; ) {
        let far = i;
        for (let j = tiles.length - 1; j > i; j--) {
            if (walkable.canWalk(at, tiles[j])) {
                far = j;
                break;
            }
        }
        path.push(tiles[far]);
        at = tiles[far];
        i = far + 1;
    }
    return path;
}
