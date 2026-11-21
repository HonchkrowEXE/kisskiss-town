// 角色的外觀（名詞表：角色、部件）。伺服器和前端都會讀；不能 import 任何 Node 專用的東西。
// 每個部件有幾種樣式，再配上顏色。畫法在前端 scene/characterArt.ts。

export const HAIR_STYLES = { short: "短髮", long: "長髮", spiky: "刺蝟頭", none: "光頭" } as const;
export const TOP_STYLES = { tshirt: "T 恤", hoodie: "帽 T" } as const;
export const BOTTOM_STYLES = { pants: "長褲", shorts: "短褲", skirt: "裙子" } as const;

/** 可選的顏色：名稱 → 色碼。 */
export const SKIN_TONES = { 淺: "#f6d5b5", 自然: "#f2c9a0", 小麥: "#d9a066", 深: "#8d5524" } as const;
export const HAIR_COLORS = { 黑: "#222222", 深棕: "#4a3020", 棕: "#8b5a2b", 金: "#e6c35c", 紅: "#b5402f", 灰: "#9e9e9e", 藍: "#3d6bd6", 粉: "#e88fb5" } as const;
export const CLOTH_COLORS = { 紅: "#d9534f", 橘: "#f0883e", 黃: "#f2c94c", 綠: "#4caf50", 藍: "#3d6bd6", 紫: "#8e5bd6", 黑: "#333333", 白: "#eeeeee", 灰: "#888888", 牛仔: "#3b4a6b" } as const;

export type Appearance = {
    hair: keyof typeof HAIR_STYLES;
    hairColor: keyof typeof HAIR_COLORS;
    skin: keyof typeof SKIN_TONES;
    top: keyof typeof TOP_STYLES;
    topColor: keyof typeof CLOTH_COLORS;
    bottom: keyof typeof BOTTOM_STYLES;
    bottomColor: keyof typeof CLOTH_COLORS;
    shoesColor: keyof typeof CLOTH_COLORS;
};

/** 沒設定過外觀的成員用這套（跟原本的預設角色一樣）。 */
export const DEFAULT_APPEARANCE: Appearance = {
    hair: "short", hairColor: "深棕", skin: "自然", top: "tshirt", topColor: "紅", bottom: "pants", bottomColor: "牛仔", shoesColor: "黑",
};

/** 每個欄位能選哪些值。 */
const CHOICES: Record<keyof Appearance, object> = {
    hair: HAIR_STYLES, hairColor: HAIR_COLORS, skin: SKIN_TONES, top: TOP_STYLES, topColor: CLOTH_COLORS,
    bottom: BOTTOM_STYLES, bottomColor: CLOTH_COLORS, shoesColor: CLOTH_COLORS,
};

/** 前端送來的外觀：每個欄位都要是可選的值，多的欄位丟掉。不合法回傳 undefined。 */
export function parseAppearance(input: unknown): Appearance | undefined {
    if (typeof input !== "object" || input === null) return undefined;
    const result: Record<string, string> = {};
    for (const [field, choices] of Object.entries(CHOICES)) {
        const value = (input as Record<string, unknown>)[field];
        if (typeof value !== "string" || !Object.hasOwn(choices, value)) return undefined;
        result[field] = value;
    }
    return result as Appearance;
}

/** 從同步狀態裡的 JSON 讀外觀；壞掉或空的用預設。 */
export const appearanceFromJson = (json: string) => {
    try {
        return parseAppearance(JSON.parse(json)) ?? DEFAULT_APPEARANCE;
    } catch {
        return DEFAULT_APPEARANCE;
    }
};
