// 畫面上共用的樣子：圖層順序、角色圖的格子、名字的位置。

import type { Direction, VoiceFigure } from "../../../server/src/rooms/schema/TownState.js";

/** hero.svg 裡四個方向的格子順序。 */
export const FRAME: Record<Direction, number> = { down: 0, left: 1, right: 2, up: 3 };

/** 名字標籤在腳底上方幾個像素。 */
export const LABEL_OFFSET = 13;

/** 圖層的前後順序：地圖在最下面，房間名稱、角色、名字依序往上。 */
export const DEPTH = { map: 0, roomName: 5, character: 10, name: 11 };

/** 名字後面的動態（名詞表）：靜音、拒聽、直播中。不在語音裡就是空字串。 */
export function dynamicsText(figure: VoiceFigure | undefined) {
    if (!figure) return "";
    return (figure.muted ? " 🔇" : "") + (figure.deafened ? " 🙉" : "") + (figure.streaming ? " 🔴" : "");
}
