// 照片生成角色（ADR-0007）：Claude 看照片回傳特徵，再對應到最接近的部件與顏色。
// 照片只在記憶體裡處理，不寫進資料庫或檔案；送到 Anthropic 處理前，前端會先告知成員。

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { CLOTH_COLORS, DEFAULT_APPEARANCE, HAIR_COLORS, SKIN_TONES, type Appearance } from "../town/appearance.js";

/** Claude 回傳的特徵。顏色用 #rrggbb，對應時取最接近的可選顏色。 */
export const PhotoFeatures = z.object({
    person_found: z.boolean().describe("照片裡有沒有看得清楚的人"),
    hair_style: z.enum(["short", "long", "spiky", "bald"]),
    hair_color: z.string().describe("頭髮顏色，#rrggbb"),
    skin_tone: z.string().describe("膚色，#rrggbb"),
    top_style: z.enum(["tshirt", "hoodie"]).describe("上衣比較像 T 恤還是帽 T（外套、襯衫都算 tshirt）"),
    top_color: z.string().describe("上衣主色，#rrggbb"),
    bottom_style: z.enum(["pants", "shorts", "skirt", "unknown"]).describe("看不到下半身就是 unknown"),
    bottom_color: z.string().describe("下身主色，#rrggbb；unknown 時隨便給"),
});
export type PhotoFeatures = z.infer<typeof PhotoFeatures>;

/** 照片：MIME 類型和 base64 內容。 */
export type Photo = { mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; base64: string };

/** 看照片、回傳特徵。正式用 Claude，測試換成假的。 */
export type PhotoReader = (photo: Photo) => Promise<PhotoFeatures>;

/** 沒辦法用 Claude（伺服器沒設定金鑰）。訊息可以直接給成員看。 */
export class PhotoUnavailable extends Error {}
/** Claude 不處理這張照片、或回的內容對應不出來。訊息可以直接給成員看。 */
export class PhotoRejected extends Error {}

const INSTRUCTIONS = `你在幫一個 2D 像素小遊戲挑角色外觀。看照片裡最主要的那個人，只描述外觀：髮型、髮色、膚色、上衣與下身的樣式和主色。
不要辨認這個人是誰，也不要描述外觀以外的事。照片裡沒有看得清楚的人時 person_found 回 false。`;

/** 用 Claude API 看照片（模型與做法見 claude-api 技能的預設：Opus 5.5、結構化輸出）。 */
export function claudePhotoReader(): PhotoReader {
    if (!process.env.ANTHROPIC_API_KEY) {
        return async () => {
            throw new PhotoUnavailable("伺服器還沒設定 Claude API，先用手動選部件");
        };
    }
    const client = new Anthropic();
    return async (photo) => {
        const response = await client.beta.messages.parse({
            model: "claude-opus-5-5",
            max_tokens: 2000,
            // 模型拒絕時由 Anthropic 依拒絕的類別自動改用別的模型重跑；全部拒絕才算失敗
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            // 簡單的看圖抽特徵，不需要深入思考
            output_config: { effort: "low", format: betaZodOutputFormat(PhotoFeatures) },
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "image", source: { type: "base64", media_type: photo.mediaType, data: photo.base64 } },
                        { type: "text", text: INSTRUCTIONS },
                    ],
                },
            ],
        });
        if (response.stop_reason === "refusal") throw new PhotoRejected("這張照片沒辦法處理，換一張或手動選部件");
        if (!response.parsed_output) throw new PhotoRejected("看不出照片裡的特徵，換一張或手動選部件");
        return response.parsed_output;
    };
}

let reader: PhotoReader | undefined;

/** 目前用的看照片方式；第一次用到才建立。 */
export const photoReader = () => (reader ??= claudePhotoReader());

/** 測試用：換成假的。 */
export const usePhotoReader = (fake: PhotoReader) => (reader = fake);

/** 把特徵對應到最接近的部件與顏色。顏色看不懂就用預設外觀的那一項。 */
export function featuresToAppearance(features: PhotoFeatures): Appearance {
    return {
        hair: features.hair_style === "bald" ? "none" : features.hair_style,
        hairColor: nearest(HAIR_COLORS, features.hair_color) ?? DEFAULT_APPEARANCE.hairColor,
        skin: nearest(SKIN_TONES, features.skin_tone) ?? DEFAULT_APPEARANCE.skin,
        top: features.top_style,
        topColor: nearest(CLOTH_COLORS, features.top_color) ?? DEFAULT_APPEARANCE.topColor,
        bottom: features.bottom_style === "unknown" ? DEFAULT_APPEARANCE.bottom : features.bottom_style,
        bottomColor: features.bottom_style === "unknown" ? DEFAULT_APPEARANCE.bottomColor : (nearest(CLOTH_COLORS, features.bottom_color) ?? DEFAULT_APPEARANCE.bottomColor),
        shoesColor: DEFAULT_APPEARANCE.shoesColor,
    };
}

/** 色表裡跟 hex 最接近的顏色名稱（RGB 距離）；hex 看不懂回傳 undefined。 */
export function nearest<T extends Record<string, string>>(palette: T, hex: string): keyof T | undefined {
    const target = rgb(hex);
    if (!target) return undefined;
    let best: keyof T | undefined;
    let bestDistance = Infinity;
    for (const [name, color] of Object.entries(palette)) {
        const c = rgb(color)!;
        const distance = (c[0] - target[0]) ** 2 + (c[1] - target[1]) ** 2 + (c[2] - target[2]) ** 2;
        if (distance < bestDistance) [best, bestDistance] = [name, distance];
    }
    return best;
}

function rgb(hex: string): [number, number, number] | undefined {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : undefined;
}
