// 像素畫共用的小工具：調亮調暗顏色、自動描外框。角色和家具都用同一套，風格才會一致。
// 畫法參考常見的 16×16 室內像素素材：光從左上來、每種材質三階明暗、外框用深棕色而不是純黑。

/** 外框顏色：深棕色，比純黑柔和。 */
export const OUTLINE = "#2b1d16";

/** 把顏色調亮（amount > 0）或調暗（amount < 0），amount 是 -1～1。 */
export function shade(hex: string, amount: number) {
    const n = parseInt(hex.slice(1), 16);
    const mix = (c: number) => Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount));
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(mix);
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/** 在 (x, y, w, h) 這塊範圍裡，替所有不透明的圖案描一圈外框（上下左右相鄰的透明像素塗成外框色）。 */
export function outline(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color = OUTLINE) {
    const image = ctx.getImageData(x, y, w, h);
    const { data } = image;
    const opaque = (px: number, py: number) => px >= 0 && py >= 0 && px < w && py < h && data[(py * w + px) * 4 + 3] > 0;
    const edges: number[] = [];
    for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
            if (opaque(px, py)) continue;
            if (opaque(px - 1, py) || opaque(px + 1, py) || opaque(px, py - 1) || opaque(px, py + 1)) edges.push(px, py);
        }
    }
    ctx.fillStyle = color;
    for (let i = 0; i < edges.length; i += 2) ctx.fillRect(x + edges[i], y + edges[i + 1], 1, 1);
}

/** 依序畫一串方塊：[x, y, 寬, 高, 顏色]。 */
export type Rect = [x: number, y: number, w: number, h: number, color: string];
export function paint(ctx: CanvasRenderingContext2D, rects: Rect[], ox = 0, oy = 0) {
    for (const [x, y, w, h, color] of rects) {
        ctx.fillStyle = color;
        ctx.fillRect(ox + x, oy + y, w, h);
    }
}
