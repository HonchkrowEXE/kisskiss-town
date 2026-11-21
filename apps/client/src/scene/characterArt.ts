// 角色的畫法：每個部件是幾個小方塊，依成員選的顏色畫上去。
// 一張角色圖 12 格 16×16：朝下、朝左、朝右、朝上，各有站著、左腳、右腳三格。
// ponytail: 部件是自己畫的簡單像素圖（作者：親親小鎮，CC0）。ADR-0007 要換成 LPC 部件，要先下載素材（要擁有者同意）；
// 換的時候改這個檔案和 ART_CREDITS，其他程式不用動。

import Phaser from "phaser";
import type { Direction } from "../../../server/src/rooms/schema/TownState.js";
import { CLOTH_COLORS, HAIR_COLORS, SKIN_TONES, type Appearance } from "../../../server/src/town/appearance.js";

/** 製作名單：每組部件的作者與授權（ADR-0007）。換成 LPC 部件時照 LPC 的 CREDITS.csv 填。 */
export const ART_CREDITS = [
    { parts: "角色部件：身體、髮型、上衣、下身、鞋子", author: "親親小鎮", license: "CC0 1.0（公眾領域）" },
    { parts: "地圖圖塊", author: "親親小鎮", license: "CC0 1.0（公眾領域）" },
];

type Rect = [x: number, y: number, w: number, h: number];
type View = "front" | "side" | "back";

/** 每個方向在圖裡的順序，以及用哪一面畫（朝左是朝右的鏡像）。 */
const DIRECTIONS: { dir: Direction; view: View; mirror: boolean }[] = [
    { dir: "down", view: "front", mirror: false },
    { dir: "left", view: "side", mirror: true },
    { dir: "right", view: "side", mirror: false },
    { dir: "up", view: "back", mirror: false },
];

/** 每個方向幾格：站著、左腳、右腳。 */
export const STEPS = 3;

const SKIN: Record<View, Rect[]> = {
    front: [[5, 4, 6, 4], [3, 10, 1, 2], [12, 10, 1, 2]],
    side: [[5, 4, 6, 4], [7, 11, 2, 1]],
    back: [[5, 4, 6, 4], [3, 10, 1, 2], [12, 10, 1, 2]],
};

const TOPS: Record<Appearance["top"], Record<View, Rect[]>> = {
    tshirt: {
        front: [[4, 8, 8, 5], [3, 8, 1, 2], [12, 8, 1, 2]],
        side: [[5, 8, 6, 5], [7, 8, 2, 3]],
        back: [[4, 8, 8, 5], [3, 8, 1, 2], [12, 8, 1, 2]],
    },
    hoodie: {
        front: [[4, 8, 8, 5], [3, 8, 1, 3], [12, 8, 1, 3], [5, 7, 6, 1]],
        side: [[5, 8, 6, 5], [7, 8, 2, 3], [4, 7, 3, 2]],
        back: [[4, 8, 8, 5], [3, 8, 1, 3], [12, 8, 1, 3], [4, 7, 8, 2]],
    },
};

/** 兩條腿在每一格的位置（最下面一列是鞋子）。抬起來的腳短一格。 */
const LEGS: Record<View, Rect[][]> = {
    front: [[[5, 13, 2, 3], [9, 13, 2, 3]], [[5, 13, 2, 3], [9, 13, 2, 2]], [[5, 13, 2, 2], [9, 13, 2, 3]]],
    side: [[[6, 13, 4, 3]], [[5, 13, 2, 3], [9, 13, 2, 3]], [[7, 13, 2, 3]]],
    back: [[[5, 13, 2, 3], [9, 13, 2, 3]], [[5, 13, 2, 2], [9, 13, 2, 3]], [[5, 13, 2, 3], [9, 13, 2, 2]]],
};

const SKIRT: Record<View, Rect[]> = { front: [[4, 12, 8, 2]], side: [[5, 12, 6, 2]], back: [[4, 12, 8, 2]] };

const EYES: Record<View, Rect[]> = { front: [[6, 5, 1, 1], [9, 5, 1, 1]], side: [[9, 5, 1, 1]], back: [] };

const HAIR: Record<Appearance["hair"], Record<View, Rect[]>> = {
    short: { front: [[5, 2, 6, 2]], side: [[5, 2, 6, 2], [5, 4, 3, 3]], back: [[5, 2, 6, 6]] },
    long: { front: [[4, 2, 8, 2], [4, 4, 1, 5], [11, 4, 1, 5]], side: [[5, 2, 6, 2], [4, 4, 4, 6]], back: [[4, 2, 8, 8]] },
    spiky: {
        front: [[5, 2, 6, 2], [5, 1, 1, 1], [7, 1, 2, 1], [10, 1, 1, 1]],
        side: [[5, 2, 6, 2], [5, 4, 3, 3], [6, 1, 1, 1], [8, 1, 1, 1]],
        back: [[5, 2, 6, 6], [5, 1, 1, 1], [7, 1, 2, 1], [10, 1, 1, 1]],
    },
    none: { front: [], side: [], back: [] },
};

/** 在 ctx 的 (ox, oy) 畫一格角色，scale 是放大倍數。 */
export function drawCharacter(ctx: CanvasRenderingContext2D, look: Appearance, dirIndex: number, step: number, ox = 0, oy = 0, scale = 1) {
    const { view, mirror } = DIRECTIONS[dirIndex];
    const paint = (color: string, rects: Rect[]) => {
        ctx.fillStyle = color;
        for (const [x, y, w, h] of rects) ctx.fillRect(ox + (mirror ? 16 - x - w : x) * scale, oy + y * scale, w * scale, h * scale);
    };
    const skin = SKIN_TONES[look.skin];
    const cloth = (name: keyof typeof CLOTH_COLORS) => CLOTH_COLORS[name];

    // 腿：最下面一列是鞋子；長褲整條、短褲只有最上面一列、裙子的腿是皮膚
    for (const [x, y, w, h] of LEGS[view][step]) {
        const legColor = look.bottom === "pants" ? cloth(look.bottomColor) : skin;
        paint(legColor, [[x, y, w, h - 1]]);
        if (look.bottom === "shorts") paint(cloth(look.bottomColor), [[x, y, w, 1]]);
        paint(cloth(look.shoesColor), [[x, y + h - 1, w, 1]]);
    }
    paint(skin, SKIN[view]);
    paint(cloth(look.topColor), TOPS[look.top][view]);
    if (look.bottom === "skirt") paint(cloth(look.bottomColor), SKIRT[view]);
    paint("#222222", EYES[view]);
    paint(HAIR_COLORS[look.hairColor], HAIR[look.hair][view]);
}

/** 這套外觀的角色圖（第一次用到才畫），回傳材質名稱。格子編號：方向 × STEPS + 步伐。 */
export function characterTexture(scene: Phaser.Scene, look: Appearance) {
    const key = `look:${JSON.stringify(look)}`;
    if (scene.textures.exists(key)) return key;
    const texture = scene.textures.createCanvas(key, 16 * DIRECTIONS.length * STEPS, 16)!;
    const ctx = texture.getContext();
    DIRECTIONS.forEach((_d, dirIndex) => {
        for (let step = 0; step < STEPS; step++) {
            const frame = dirIndex * STEPS + step;
            drawCharacter(ctx, look, dirIndex, step, frame * 16, 0);
            texture.add(frame, 0, frame * 16, 0, 16, 16);
        }
    });
    texture.refresh();
    return key;
}

/** 面向在圖裡是第幾個方向。 */
export const directionIndex = (dir: string) => Math.max(0, DIRECTIONS.findIndex((d) => d.dir === dir));
