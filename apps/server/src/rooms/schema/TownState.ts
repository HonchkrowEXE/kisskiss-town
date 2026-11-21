import { schema, t, type SchemaType } from "@colyseus/schema";

export const Vec2 = schema({
    x: t.number(),
    y: t.number(),
}, "Vec2");
export type Vec2 = SchemaType<typeof Vec2>;

export const DIRECTIONS = ["down", "left", "right", "up"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const Character = schema({
    name: t.string(),
    position: Vec2, // 腳底的位置，像素
    dir: t.string().default("down"), // 面向，DIRECTIONS 其中一個
    chips: t.number(), // 籌碼餘額，只有伺服器經過籌碼帳本才能改
}, "Character");
export type Character = SchemaType<typeof Character>;

export const TownState = schema({
    characters: t.map(Character),
    map: t.string(), // TownMapState 的 JSON：地圖、房間、出生點；頻道變動時整份換掉
}, "TownState");
export type TownState = SchemaType<typeof TownState>;
