import type { Client } from "colyseus";
import type { ChipLedger, ChipOwner } from "../chips/ChipLedger.js";
import type { ChannelRoom, TownLayout } from "../town/layoutTown.js";
import type { TownSettings } from "../town/TownSettings.js";
import type { Walkable } from "../town/walkable.js";
import type { Character, TownState } from "./schema/TownState.js";

/**
 * 換房間的原因。只有自己走進去（walk）才算「走進」：語音房只在這時候搬頻道；
 * 被搧、入座、地圖重排（other）只記下現在在哪。
 */
export type RoomChangeCause = "walk" | "other";

/**
 * 功能（features/ 底下的每個類別）能看到、能做的事。由 TownRoom 實作。
 * 功能之間不直接互相呼叫，都經過這裡，所以加一個功能不用改其他功能。
 */
export interface Town {
    /** 這座小鎮對應的伺服器 ID。 */
    readonly guildId: string;
    /** 同步給所有前端的狀態。 */
    readonly state: TownState;
    /** 目前的地圖版面（頻道變動時會整份換掉）。 */
    readonly layout: TownLayout;
    /** 目前地圖的碰撞判斷（含擋路的家具）。 */
    readonly walkable: Walkable;
    /** 只看地圖、不含家具的碰撞判斷（擺家具時用）。 */
    readonly baseWalkable: Walkable;
    /** 伺服器時鐘（毫秒）。用它算冷卻、設計時器，小鎮關閉時計時器會一起清掉。 */
    readonly clock: { currentTime: number; setTimeout(run: () => void, ms: number): { clear(): void } };
    readonly ledger: ChipLedger;
    readonly townSettings: TownSettings;

    /** 找到某個 sessionId 的連線；已經離開就是 undefined。 */
    clientOf(sessionId: string): Client | undefined;
    /** 同一位成員可能開了好幾個分頁，每個分頁的角色都要一起改。 */
    forEachCharacterOf(userId: string, change: (character: Character) => void): void;
    /** 成員現在站在哪個房間；在廣場或走廊就是 undefined。 */
    roomOf(sessionId: string): ChannelRoom | undefined;
    /** 伺服器移動了角色（被搧、入座）之後呼叫：記下他現在在哪個房間。 */
    placeIn(sessionId: string, room: ChannelRoom | undefined, cause: RoomChangeCause): void;
    /** 擋路的家具換了：之後的碰撞判斷加上這些格子。 */
    setBlockedTiles(tiles: number[]): void;
    /** 伺服器移動了角色之後呼叫：前端在路上、從舊位置算的移動會被拒絕並拉回新位置。 */
    holdStill(sessionId: string): void;
    /** 送訊息給小鎮裡的每個人。 */
    sendToAll(type: string, message: unknown): void;
}

/** 籌碼帳本、成員設定用的身分：登入時驗證過、簽進 JWT 的伺服器和帳號。 */
export const memberOf = (client: Client): ChipOwner => ({ guildId: client.auth.guildId, userId: client.auth.id });
