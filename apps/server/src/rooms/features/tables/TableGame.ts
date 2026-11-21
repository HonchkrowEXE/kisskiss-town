import type { ChipOwner } from "../../../chips/ChipLedger.js";
import type { GameKind } from "../../../town/tables.js";

/** 坐在桌邊的一個人。離開後這個物件還留在遊戲的這一局裡，結算時照樣找得到他的籌碼帳戶。 */
export type TableSeat = { sessionId: string; owner: ChipOwner; name: string };

/** 遊戲能對桌子做的事。由 GameTables 實作。 */
export interface TableContext {
    /** 現在坐在桌邊的人，照座位順序。 */
    seated(): TableSeat[];
    /** 這個人現在有多少籌碼。 */
    balanceOf(seat: TableSeat): number;
    /** 一局結算：每人押 bet、拿回 payout，一起記進籌碼帳本（一起成功或一起失敗）。 */
    settle(entries: { seat: TableSeat; bet: number; payout: number }[]): void;
    /** 只告訴這個人一句話（例如「還沒輪到你」）。 */
    tell(seat: TableSeat, ok: boolean, message: string): void;
    /** 遊戲畫面變了：重新送公開畫面和每個人的私人畫面。 */
    changed(): void;
    /** ms 毫秒後執行；回傳取消的函式。 */
    setTimer(ms: number, run: () => void): () => void;
    /** 0～n-1 的亂數整數（伺服器用 crypto）。 */
    randomInt(n: number): number;
}

/** 規則不允許的動作。訊息會直接顯示給那個人看。 */
export class GameError extends Error {}

/** 前端送來的遊戲動作。payload 來自前端，不可信，每個遊戲自己檢查。 */
export type GameAction = (seat: TableSeat, payload: Record<string, unknown>) => void;

/**
 * 遊戲桌上的一種遊戲。GameTables 管座位，遊戲管規則和輸贏。
 *
 * 加一種新遊戲：
 *   1. 規則寫成 games/ 底下的純邏輯模組並測試
 *   2. 寫一個類別繼承 TableGame：actions() 列出前端能做的動作，publicView() 給大家看的畫面
 *   3. 在 town/tables.ts 的 GAME_KINDS 加一種，在 GameTables 的 createGame 加一行
 *   4. 前端在 ui/tables/ 加一個面板
 */
export abstract class TableGame {
    abstract readonly kind: GameKind;

    constructor(protected readonly table: TableContext) {}

    /** 前端能做的動作：動作名稱 → 處理函式。不合規則就丟 GameError。 */
    abstract actions(): Record<string, GameAction>;

    /** 大家都看得到的遊戲畫面（會轉成 JSON 送給所有人）。不能放藏起來的牌或骰子。 */
    abstract publicView(): unknown;

    /** 只有這個人看得到的東西（例如自己的骰子）；沒有就是 undefined。 */
    privateView(_seat: TableSeat): unknown {
        return undefined;
    }

    /** 有人起身或斷線。每種遊戲要明確決定怎麼處理（退出、算停牌、算輸）。 */
    abstract onSeatLeft(seat: TableSeat): void;

    /** 桌子被移除：取消計時器。 */
    dispose(): void {}
}
