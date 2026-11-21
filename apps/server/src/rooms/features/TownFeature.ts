import type { Client } from "colyseus";
import type { ChannelRoom } from "../../town/layoutTown.js";
import type { RoomChangeCause, Town } from "../Town.js";

/** 前端送來的訊息的處理函式。payload 來自前端，不可信，每個功能自己檢查。 */
export type MessageHandler = (client: Client, payload: unknown) => void;

/**
 * 小鎮的一個功能（例如搧巴掌、遊戲桌）。TownRoom 把前端訊息和事件分給各個功能。
 *
 * 加一個新功能：
 *   1. 在 features/ 底下寫一個類別繼承 TownFeature
 *   2. 在 messages() 列出它處理的前端訊息
 *   3. 需要的話覆寫下面的事件（成員進出、換房間、地圖更新）
 *   4. 在 TownRoom 的 features 清單加上它
 */
export abstract class TownFeature {
    constructor(protected readonly town: Town) {}

    /** 這個功能處理的前端訊息：訊息類型 → 處理函式。 */
    messages(): Record<string, MessageHandler> {
        return {};
    }

    /** 成員按了互動鍵（E）。旁邊有這個功能能互動的東西就處理並回傳 true，沒有就回傳 false 讓下一個功能試。 */
    interact(_client: Client): boolean {
        return false;
    }

    /** 成員進小鎮，角色剛建立好。 */
    onJoin(_client: Client): void {}

    /** 成員離開小鎮，角色還沒刪掉。 */
    onLeave(_client: Client): void {}

    /** 成員換了房間（走進、被搧、入座、地圖重排）。before 是原本房間的 ID。 */
    onRoomChanged(_client: Client, _room: ChannelRoom | undefined, _before: string | undefined, _cause: RoomChangeCause): void {}

    /** 地圖換了一份新的（頻道變動）。 */
    async onLayoutChanged(): Promise<void> {}

    /** 小鎮關閉：取消訂閱之類的收尾。 */
    dispose(): void {}
}
