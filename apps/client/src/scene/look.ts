// 畫面上共用的樣子：圖層順序、名字的位置、動態文字。角色本身的畫法在 characterArt.ts。

import type { VoiceFigure } from "../../../server/src/rooms/schema/TownState.js";

/** 名字標籤在腳底上方幾個像素。 */
export const LABEL_OFFSET = 13;

/** 圖層的前後順序：地圖在最下面，房間名稱、角色、名字依序往上。 */
export const DEPTH = { map: 0, roomName: 5, character: 10, name: 11 };

/** 名字後面的動態（名詞表）：靜音、拒聽、直播中。不在語音裡就是空字串。 */
export function dynamicsText(figure: VoiceFigure | undefined) {
    if (!figure) return "";
    return (figure.muted ? " 🔇" : "") + (figure.deafened ? " 🙉" : "") + (figure.streaming ? " 🔴" : "");
}
