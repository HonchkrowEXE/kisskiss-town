// 遊戲桌放在地圖上的規則。伺服器和前端都會讀；不能 import 任何 Node 專用的東西。

import { roomAt, type TownLayout } from "./layoutTown.js";
import type { Walkable } from "./walkable.js";

/** 遊戲桌上玩的遊戲。加新遊戲：這裡加一種，再寫一個 TableGame 類別和前端的面板。 */
export const GAME_KINDS = ["dice", "blackjack", "liar"] as const;
export type GameKind = (typeof GAME_KINDS)[number];

export const GAME_TITLES: Record<GameKind, string> = { dice: "骰子比大小", blackjack: "21 點", liar: "吹牛" };
export const GAME_ICONS: Record<GameKind, string> = { dice: "🎲", blackjack: "🃏", liar: "🤥" };

/** 一張遊戲桌放在哪、玩什麼。x、y 是桌子中心（像素）。 */
export type TablePlacement = { id: string; game: GameKind; x: number; y: number };

/** 座位相對桌子中心的位置：上下各一、左右各二，共 6 個。 */
const SEAT_OFFSETS = [[-20, -12], [0, -20], [20, -12], [20, 12], [0, 20], [-20, 12]];

/** 兩張桌子中心至少要隔多遠，座位才不會重疊。 */
export const TABLE_SPACING = 56;

/** 桌子周圍每個座位（成員入座時站的位置）。 */
export const seatsAround = (x: number, y: number) => SEAT_OFFSETS.map(([dx, dy]) => ({ x: x + dx, y: y + dy }));

/** 桌子能不能放在這裡：每個座位都站得住、不在房間裡（房間是頻道，不放桌子）。 */
export function canPlaceTable(x: number, y: number, layout: TownLayout, walkable: Walkable) {
    return seatsAround(x, y).every((s) => walkable.canStand(s.x, s.y) && !roomAt(layout.rooms, s.x, s.y)) && !roomAt(layout.rooms, x, y);
}

/** 管理員還沒擺過桌子時的預設：廣場左側兩張、右側一張。 */
export function defaultTables(layout: TownLayout): TablePlacement[] {
    const tile = layout.map.tilewidth;
    const y = 3 * tile; // 廣場正中間那一列（廣場是第 1～4 列）
    const right = (layout.map.width - 6) * tile;
    return [
        { id: "table-1", game: "dice", x: 6 * tile, y },
        { id: "table-2", game: "blackjack", x: 12 * tile, y },
        { id: "table-3", game: "liar", x: right, y },
    ];
}
