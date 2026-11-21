// 角色的畫法：大頭的 Q 版像素人，每個部件依成員選的顏色畫，自動加明暗（光從左上來）和深棕色外框。
// 一張角色圖 12 格 16×16：朝下、朝左、朝右、朝上，各有站著、左腳、右腳三格。
// ponytail: 部件是自己畫的像素圖（作者：親親小鎮，CC0）。ADR-0007 要換成 LPC 部件，要先下載素材（要擁有者同意）；
// 換的時候改這個檔案和 ART_CREDITS，其他程式不用動。

import Phaser from "phaser";
import type { Direction } from "../../../server/src/rooms/schema/TownState.js";
import { CLOTH_COLORS, HAIR_COLORS, SKIN_TONES, type Appearance } from "../../../server/src/town/appearance.js";
import { OUTLINE, outline, paint, shade, type Rect } from "./pixelArt.js";

/** 製作名單：每組部件的作者與授權（ADR-0007）。換成 LPC 部件時照 LPC 的 CREDITS.csv 填。 */
export const ART_CREDITS = [
    { parts: "角色部件：身體、髮型、上衣、下身、鞋子", author: "親親小鎮", license: "CC0 1.0（公眾領域）" },
    { parts: "地圖圖塊、家具", author: "親親小鎮", license: "CC0 1.0（公眾領域）" },
];

type Box = [x: number, y: number, w: number, h: number];
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

/** 頭：大頭（8×7），Q 版比例。 */
const HEAD: Record<View, Box> = { front: [4, 2, 8, 7], side: [5, 2, 7, 7], back: [4, 2, 8, 7] };
/** 身體、手臂、手。 */
const TORSO: Record<View, Box> = { front: [5, 9, 6, 4], side: [6, 9, 5, 4], back: [5, 9, 6, 4] };
const ARMS: Record<View, Box[]> = { front: [[4, 9, 1, 3], [11, 9, 1, 3]], side: [[8, 9, 2, 3]], back: [[4, 9, 1, 3], [11, 9, 1, 3]] };
const HANDS: Record<View, Box[]> = { front: [[4, 12, 1, 1], [11, 12, 1, 1]], side: [[8, 12, 2, 1]], back: [[4, 12, 1, 1], [11, 12, 1, 1]] };
/** 兩條腿在每一格的位置；最下面一列是鞋子。抬起來的腳短一格。 */
const LEGS: Record<View, Box[][]> = {
    front: [[[5, 13, 2, 3], [9, 13, 2, 3]], [[5, 13, 2, 3], [9, 13, 2, 2]], [[5, 13, 2, 2], [9, 13, 2, 3]]],
    side: [[[6, 13, 4, 3]], [[5, 13, 2, 3], [9, 13, 2, 2]], [[7, 13, 2, 3]]],
    back: [[[5, 13, 2, 3], [9, 13, 2, 3]], [[5, 13, 2, 2], [9, 13, 2, 3]], [[5, 13, 2, 3], [9, 13, 2, 2]]],
};
const SKIRT: Record<View, Box> = { front: [4, 11, 8, 3], side: [5, 11, 6, 3], back: [4, 11, 8, 3] };

const HAIR: Record<Appearance["hair"], Record<View, Box[]>> = {
    short: { front: [[4, 1, 8, 3], [4, 4, 1, 2], [11, 4, 1, 2]], side: [[5, 1, 7, 3], [5, 4, 3, 3]], back: [[4, 1, 8, 7]] },
    long: { front: [[3, 1, 10, 3], [3, 4, 2, 6], [11, 4, 2, 6]], side: [[4, 1, 8, 3], [4, 4, 4, 7]], back: [[3, 1, 10, 9]] },
    spiky: {
        front: [[4, 1, 8, 3], [4, 4, 1, 1], [11, 4, 1, 1], [4, 0, 1, 1], [6, 0, 2, 1], [9, 0, 1, 1], [11, 0, 1, 1]],
        side: [[5, 1, 7, 3], [5, 4, 3, 2], [5, 0, 1, 1], [7, 0, 1, 1], [9, 0, 1, 1]],
        back: [[4, 1, 8, 7], [4, 0, 1, 1], [6, 0, 2, 1], [9, 0, 1, 1], [11, 0, 1, 1]],
    },
    none: { front: [], side: [], back: [] },
};

/** 一塊有明暗的方塊：底色、上面一排亮一點、右邊一排暗一點（光從左上來）。 */
function lit([x, y, w, h]: Box, color: string, light = 0.14, dark = -0.24): Rect[] {
    const rects: Rect[] = [[x, y, w, h, color]];
    if (h > 1) rects.push([x, y, w, 1, shade(color, light)]);
    if (w > 1) rects.push([x + w - 1, y + (h > 1 ? 1 : 0), 1, h - (h > 1 ? 1 : 0), shade(color, dark)]);
    return rects;
}

/** 畫一格角色（16×16）到 ctx：先畫部件，再描外框。 */
function drawFrame(ctx: CanvasRenderingContext2D, look: Appearance, view: View, step: number) {
    const skin = SKIN_TONES[look.skin];
    const top = CLOTH_COLORS[look.topColor];
    const bottom = CLOTH_COLORS[look.bottomColor];
    const shoes = CLOTH_COLORS[look.shoesColor];
    const hair = HAIR_COLORS[look.hairColor];
    const rects: Rect[] = [];

    // 腿：最下面一列是鞋子；長褲整條、短褲只有最上面一列、裙子的腿是皮膚
    for (const [x, y, w, h] of LEGS[view][step]) {
        rects.push(...lit([x, y, w, h - 1], look.bottom === "pants" ? bottom : skin, 0, -0.2));
        if (look.bottom === "shorts") rects.push([x, y, w, 1, bottom]);
        rects.push([x, y + h - 1, w, 1, shoes], [x, y + h - 1, 1, 1, shade(shoes, 0.2)]);
    }
    // 身體與手臂
    rects.push(...lit(TORSO[view], top));
    for (const arm of ARMS[view]) rects.push(...lit(arm, shade(top, -0.08), 0.1, -0.15));
    if (look.top === "hoodie") {
        const [tx, ty, tw] = TORSO[view];
        rects.push([tx + 1, ty + 2, tw - 2, 1, shade(top, -0.2)]); // 口袋
        if (view !== "back") rects.push([tx, ty - 1, tw, 1, shade(top, -0.15)]); // 帽子領口
    }
    if (look.bottom === "skirt") rects.push(...lit(SKIRT[view], bottom));
    for (const [x, y, w, h] of HANDS[view]) rects.push([x, y, w, h, skin]);

    // 頭與臉
    rects.push(...lit(HEAD[view], skin, 0.1, -0.12));
    if (view === "front") rects.push([6, 5, 1, 2, OUTLINE], [9, 5, 1, 2, OUTLINE], [5, 7, 1, 1, "#f2a3a3"], [10, 7, 1, 1, "#f2a3a3"]);
    if (view === "side") rects.push([10, 5, 1, 2, OUTLINE], [9, 7, 1, 1, "#f2a3a3"]);

    // 頭髮：底色、亮面（左上一小段）
    const hairBoxes = HAIR[look.hair][view];
    for (const box of hairBoxes) rects.push([...box, hair]);
    if (hairBoxes.length) {
        const [hx, hy, hw] = hairBoxes[0];
        rects.push([hx + 1, hy, Math.max(1, Math.floor(hw / 3)), 1, shade(hair, 0.35)]);
        rects.push([hx + hw - 1, hy + 1, 1, 2, shade(hair, -0.25)]);
    } else {
        const [hx, hy] = HEAD[view];
        rects.push([hx + 1, hy, 2, 1, shade(skin, 0.3)]); // 光頭的反光
    }
    // 背面的帽 T：帽子蓋在後腦勺下面
    if (look.top === "hoodie" && view === "back") rects.push(...lit([5, 7, 6, 2], shade(top, -0.1)));

    paint(ctx, rects);
    outline(ctx, 0, 0, 16, 16);
}

/** 一格角色的畫布（16×16），已經描好外框。朝左是朝右的鏡像。 */
function frameCanvas(look: Appearance, dirIndex: number, step: number) {
    const { view, mirror } = DIRECTIONS[dirIndex];
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 16;
    const ctx = canvas.getContext("2d")!;
    if (mirror) {
        ctx.translate(16, 0);
        ctx.scale(-1, 1);
    }
    drawFrame(ctx, look, view, step);
    return canvas;
}

/** 在 ctx 的 (ox, oy) 畫一格角色，scale 是放大倍數（換裝預覽用）。 */
export function drawCharacter(ctx: CanvasRenderingContext2D, look: Appearance, dirIndex: number, step: number, ox = 0, oy = 0, scale = 1) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(frameCanvas(look, dirIndex, step), ox, oy, 16 * scale, 16 * scale);
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
