// 搧巴掌的判定：誰會被搧到、被打退到哪。純函式，伺服器用它決定結果（前端只播動畫）。

import type { Direction } from "../rooms/schema/TownState.js";
import type { Walkable } from "./walkable.js";

type Point = { x: number; y: number };

/** 多近算「旁邊」（像素，腳底到腳底）：一格 16px 再多一點，站在隔壁格斜角也搧得到。 */
export const SLAP_RANGE = 24;

/** 被搧後退幾個像素：一格。 */
export const KNOCKBACK = 16;

const FACING: Record<Direction, Point> = { down: { x: 0, y: 1 }, up: { x: 0, y: -1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };

/** 離 slapper 最近、在 SLAP_RANGE 內的別人（同一個帳號開的其他分頁不算）。沒有就回傳 undefined。 */
export function findSlapTarget<T extends { userId: string; position: Point }>(
    slapper: T,
    others: Iterable<[string, T]>,
): [string, T] | undefined {
    let best: [string, T] | undefined;
    let bestDistance = SLAP_RANGE;
    for (const [id, other] of others) {
        if (other.userId === slapper.userId) continue;
        const distance = Math.hypot(other.position.x - slapper.position.x, other.position.y - slapper.position.y);
        if (distance <= bestDistance) {
            best = [id, other];
            bestDistance = distance;
        }
    }
    return best;
}

/**
 * 被搧的人往遠離搧人者的方向退一格（取水平或垂直中差比較多的那個方向）；
 * 兩人站在同一點時往搧人者面向的方向退。後面是牆就原地不動。
 */
export function knockback(from: Point, to: Point, facing: Direction, walkable: Walkable): Point {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const unit = dx === 0 && dy === 0 ? FACING[facing] : Math.abs(dx) >= Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) };
    const next = { x: to.x + unit.x * KNOCKBACK, y: to.y + unit.y * KNOCKBACK };
    return walkable.canWalk(to, next) ? next : { ...to };
}
