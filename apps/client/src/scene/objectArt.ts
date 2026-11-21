// 家具的畫法：每種家具是幾個小方塊，畫成一張材質。加新家具就在 ART 加一筆。

import Phaser from "phaser";
import { OBJECT_KINDS, type ObjectKind } from "../../../server/src/town/objects.js";

type Rect = [x: number, y: number, w: number, h: number, color: string];

/** 每種家具的方塊（單位：像素，以家具左上角為原點；大小是 OBJECT_KINDS 的格數 × 16）。 */
const ART: Record<ObjectKind, Rect[]> = {
    table: [
        [1, 3, 30, 9, "#8b5a2b"], // 桌面
        [1, 3, 30, 2, "#a8743f"], // 桌面亮邊
        [2, 12, 2, 4, "#5e3b1c"], // 桌腳
        [28, 12, 2, 4, "#5e3b1c"],
        [9, 6, 6, 3, "#f5f0e6"], // 桌上的小桌巾
        [21, 5, 3, 3, "#e8695e"], // 杯子
    ],
    chair: [
        [3, 1, 10, 6, "#b9774a"], // 椅背
        [4, 2, 8, 4, "#d08c5b"],
        [3, 7, 10, 4, "#b9774a"], // 椅墊
        [3, 7, 10, 1, "#d08c5b"],
        [3, 11, 2, 4, "#6e4325"], // 椅腳
        [11, 11, 2, 4, "#6e4325"],
    ],
    computer: [
        [1, 10, 14, 5, "#7a5230"], // 小桌
        [3, 1, 10, 8, "#2f3640"], // 螢幕外框
        [4, 2, 8, 6, "#5ec8ff"], // 螢幕
        [5, 3, 3, 1, "#ffffff"], // 螢幕上的字
        [5, 5, 5, 1, "#c5f0ff"],
        [7, 9, 2, 1, "#2f3640"], // 支架
        [4, 11, 8, 1, "#d9d9d9"], // 鍵盤
    ],
    tv: [
        [2, 11, 28, 5, "#6e4325"], // 電視櫃
        [2, 11, 28, 1, "#8b5a2b"],
        [3, 0, 26, 11, "#1e2126"], // 電視外框
        [4, 1, 24, 9, "#33415c"], // 螢幕
        [6, 2, 6, 2, "#4f6385"], // 反光
        [13, 12, 6, 2, "#c9a56b"], // 櫃子抽屜把手
    ],
};

/** 這種家具的材質（第一次用到才畫），回傳材質名稱。 */
export function objectTexture(scene: Phaser.Scene, kind: ObjectKind) {
    const key = `object:${kind}`;
    if (scene.textures.exists(key)) return key;
    const { width, height } = OBJECT_KINDS[kind];
    const texture = scene.textures.createCanvas(key, width * 16, height * 16)!;
    const ctx = texture.getContext();
    for (const [x, y, w, h, color] of ART[kind]) {
        ctx.fillStyle = color;
        ctx.fillRect(x, y, w, h);
    }
    texture.refresh();
    return key;
}
