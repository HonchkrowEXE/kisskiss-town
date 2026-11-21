import { schema, t, type SchemaType } from "@colyseus/schema";

export const Vec2 = schema({
    x: t.number(),
    y: t.number(),
}, "Vec2");
export type Vec2 = SchemaType<typeof Vec2>;

export const DIRECTIONS = ["down", "left", "right", "up"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const Character = schema({
    userId: t.string(), // 成員的平台帳號 ID，用來對上他的語音狀態
    name: t.string(),
    position: Vec2, // 腳底的位置，像素
    dir: t.string().default("down"), // 面向，DIRECTIONS 其中一個
    chips: t.number(), // 籌碼餘額，只有伺服器經過籌碼帳本才能改
    slappable: t.boolean().default(true), // 可被搧；成員自己在設定裡開關
    seatedAt: t.string().default(""), // 坐在哪張遊戲桌（桌子 ID），沒坐是空字串；坐著時不能走動
}, "Character");
export type Character = SchemaType<typeof Character>;

/** 在語音頻道裡的成員，站在對應語音房裡。有打開小鎮的人前端改用他的角色顯示。 */
export const VoiceFigure = schema({
    name: t.string(),
    channelId: t.string(),
    x: t.number(),
    y: t.number(),
    muted: t.boolean(),
    deafened: t.boolean(),
    streaming: t.boolean(),
}, "VoiceFigure");
export type VoiceFigure = SchemaType<typeof VoiceFigure>;

/** 一張遊戲桌的狀態。桌子和座位的位置在地圖資料（TownMapState.tables）裡。 */
export const GameTable = schema({
    seats: t.array("string"), // 每個座位坐的人（sessionId），空位是空字串
    bettors: t.array("string"), // 這一局已經下注的人（sessionId），照下注順序
    result: t.string(), // 上一局結果的 JSON：[{ name, dice, delta }]，還沒玩過是空字串
}, "GameTable");
export type GameTable = SchemaType<typeof GameTable>;

export const TownState = schema({
    characters: t.map(Character),
    voice: t.map(VoiceFigure), // key 是成員的平台帳號 ID
    map: t.string(), // TownMapState 的 JSON：地圖、房間、出生點、遊戲桌；頻道變動時整份換掉
    tables: t.map(GameTable), // key 是桌子 ID
}, "TownState");
export type TownState = SchemaType<typeof TownState>;
