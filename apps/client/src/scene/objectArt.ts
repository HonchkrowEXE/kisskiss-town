// 家具的畫法：俯視斜角（看得到桌面和正面），三階明暗、光從左上來，最後描深棕色外框。
// 加新家具就在 ART 加一筆；方塊要留 1px 邊，外框才畫得下。

import Phaser from "phaser";
import { OBJECT_KINDS, type ObjectKind } from "../../../server/src/town/objects.js";
import { outline, paint, shade, type Rect } from "./pixelArt.js";

const WOOD = "#a8703f";
const WOOD_DARK = shade(WOOD, -0.3);
const WOOD_LIGHT = shade(WOOD, 0.2);

/** 每種家具的方塊（單位：像素，以家具左上角為原點；大小是 OBJECT_KINDS 的格數 × 16）。 */
const ART: Record<ObjectKind, Rect[]> = {
    table: [
        [2, 11, 2, 4, WOOD_DARK], // 桌腳
        [28, 11, 2, 4, WOOD_DARK],
        [1, 2, 30, 8, WOOD], // 桌面
        [1, 2, 30, 1, WOOD_LIGHT], // 桌面亮邊
        [3, 5, 9, 1, shade(WOOD, -0.1)], // 木紋
        [16, 7, 11, 1, shade(WOOD, -0.1)],
        [1, 10, 30, 2, WOOD_DARK], // 桌子正面
        [10, 3, 12, 6, "#f3ead8"], // 桌巾
        [10, 3, 12, 1, "#fffaf0"],
        [10, 8, 12, 1, "#d9cdb4"],
        [13, 4, 3, 3, "#e8695e"], // 杯子
        [13, 4, 3, 1, "#f59a90"],
        [18, 5, 2, 2, "#7cb26b"], // 小盆栽
        [18, 4, 2, 1, "#a3d18f"],
    ],
    chair: [
        [3, 11, 2, 4, WOOD_DARK], // 椅腳
        [11, 11, 2, 4, WOOD_DARK],
        [3, 1, 10, 6, WOOD], // 椅背
        [3, 1, 10, 1, WOOD_LIGHT],
        [5, 2, 1, 4, WOOD_DARK], // 椅背的木條
        [8, 2, 1, 4, WOOD_DARK],
        [11, 2, 1, 4, WOOD_DARK],
        [2, 7, 12, 3, "#c95f4a"], // 坐墊
        [2, 7, 12, 1, "#e07d68"],
        [2, 10, 12, 1, WOOD_DARK], // 椅子正面
    ],
    computer: [
        [2, 13, 2, 2, WOOD_DARK], // 小桌腳
        [12, 13, 2, 2, WOOD_DARK],
        [1, 9, 14, 3, WOOD], // 小桌桌面
        [1, 9, 14, 1, WOOD_LIGHT],
        [1, 12, 14, 1, WOOD_DARK],
        [3, 1, 10, 7, "#3a3f4b"], // 螢幕外框
        [4, 2, 8, 5, "#3fa7e0"], // 螢幕
        [4, 2, 8, 1, "#7fd0ff"],
        [5, 3, 3, 1, "#ffffff"], // 螢幕上的字
        [5, 5, 5, 1, "#bfe9ff"],
        [9, 3, 2, 1, "#ffd166"],
        [7, 8, 2, 1, "#3a3f4b"], // 支架
        [4, 10, 7, 1, "#e6e6e6"], // 鍵盤
        [5, 10, 1, 1, "#b8b8b8"],
        [7, 10, 1, 1, "#b8b8b8"],
        [9, 10, 1, 1, "#b8b8b8"],
        [12, 10, 2, 1, "#d9d9d9"], // 滑鼠
    ],
    tv: [
        [2, 10, 28, 5, WOOD], // 電視櫃
        [2, 10, 28, 1, WOOD_LIGHT],
        [4, 12, 11, 2, shade(WOOD, -0.12)], // 抽屜
        [17, 12, 11, 2, shade(WOOD, -0.12)],
        [9, 12, 2, 1, "#e0c08a"], // 把手
        [22, 12, 2, 1, "#e0c08a"],
        [14, 9, 4, 1, "#2a2d34"], // 底座
        [3, 1, 26, 8, "#2a2d34"], // 電視外框
        [4, 2, 24, 6, "#2f4a6e"], // 螢幕
        [4, 2, 24, 1, "#46699a"],
        [6, 3, 5, 1, "#6c8fc4"], // 反光
        [7, 4, 3, 1, "#58799f"],
        [26, 7, 1, 1, "#e85d5d"], // 電源燈
    ],
};

/** 這種家具的材質（第一次用到才畫），回傳材質名稱。 */
export function objectTexture(scene: Phaser.Scene, kind: ObjectKind) {
    const key = `object:${kind}`;
    if (scene.textures.exists(key)) return key;
    const { width, height } = OBJECT_KINDS[kind];
    const texture = scene.textures.createCanvas(key, width * 16, height * 16)!;
    const ctx = texture.getContext();
    paint(ctx, ART[kind]);
    outline(ctx, 0, 0, width * 16, height * 16);
    texture.refresh();
    return key;
}
