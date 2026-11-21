import type { Room } from "@colyseus/sdk";
import type { GameTable, TownState } from "../../../server/src/rooms/schema/TownState.js";
import { DICE_STAKE } from "../../../server/src/games/diceDuel.js";

type ResultRow = { name: string; dice: [number, number]; delta: number };
type TableView = { seats: { name: string; bet: boolean }[]; bet: boolean; result: ResultRow[] };

/** 名字是成員自己取的，一律用 textContent，不拼 HTML。 */
const el = (tag: string, text = "", className = "") => Object.assign(document.createElement(tag), { textContent: text, className });

/** 入座時浮在地圖上的遊戲畫面：誰坐在這桌、誰下注了、上一局結果，以及下注、擲骰、離開的按鈕。 */
export class TablePanel {
    private element = document.createElement("section");
    /** 上次畫的內容；狀態每次同步都會檢查，沒變就不重畫，按鈕的焦點才不會一直跑掉。 */
    private shown = "";

    private room: Room<any, TownState>;

    constructor(room: Room<any, TownState>) {
        this.room = room;
        this.element.className = "table-panel";
        this.element.hidden = true;
        this.element.setAttribute("aria-label", "遊戲桌");
        document.body.append(this.element);

        this.element.addEventListener("click", (e) => {
            const action = (e.target as HTMLElement).dataset.action;
            if (action) room.send(action);
        });
        room.onStateChange((state) => this.render(this.viewOf(state)));
    }

    /** 自己坐的那桌要顯示什麼；沒入座是 undefined。 */
    private viewOf(state: TownState): TableView | undefined {
        const tableId = state.characters?.get(this.room.sessionId)?.seatedAt;
        const table: GameTable | undefined = tableId ? state.tables.get(tableId) : undefined;
        if (!table) return undefined;
        const nameOf = (sessionId: string) => state.characters.get(sessionId)?.name ?? "";
        return {
            seats: table.seats.filter((s) => s).map((s) => ({ name: nameOf(s), bet: table.bettors.includes(s) })),
            bet: table.bettors.includes(this.room.sessionId),
            result: table.result ? (JSON.parse(table.result) as ResultRow[]) : [],
        };
    }

    private render(view: TableView | undefined) {
        const key = JSON.stringify(view ?? null);
        if (key === this.shown) return;
        this.shown = key;
        this.element.hidden = !view;
        if (!view) return;

        const seats = el("ul", "", "table-seats");
        for (const s of view.seats) seats.append(el("li", s.bet ? `${s.name} ✅ 已下注` : s.name));
        const actions = el("div", "", "table-actions");
        actions.append(this.button("bet", `下注 ${DICE_STAKE}`, view.bet), this.button("roll", "擲骰", !view.bet), this.button("stand", "離開（E）"));
        const children: Node[] = [el("h2", `🎲 骰子比大小・每局 ${DICE_STAKE} 籌碼`), seats, actions];
        if (view.result.length) {
            const result = el("ul", "", "table-result");
            for (const r of view.result) {
                result.append(el("li", `${r.name}：${r.dice[0]} + ${r.dice[1]} = ${r.dice[0] + r.dice[1]}，${r.delta > 0 ? "+" : ""}${r.delta}`));
            }
            children.push(el("p", "上一局"), result);
        }
        this.element.replaceChildren(...children);
    }

    private button(action: string, text: string, disabled = false) {
        const b = Object.assign(el("button", text) as HTMLButtonElement, { type: "button", disabled });
        b.dataset.action = action;
        return b;
    }
}
