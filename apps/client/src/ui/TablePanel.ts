import type { Room } from "@colyseus/sdk";
import type { TownState } from "../../../server/src/rooms/schema/TownState.js";
import { GAME_ICONS, GAME_TITLES, type GameKind } from "../../../server/src/town/tables.js";
import { BlackjackPanel } from "./tables/BlackjackPanel.js";
import { DicePanel } from "./tables/DicePanel.js";
import { el, type GamePanel } from "./tables/GamePanel.js";
import { LiarPanel } from "./tables/LiarPanel.js";

/** 每種遊戲的畫面。加新遊戲就加一行。 */
const PANELS: Record<GameKind, GamePanel> = { dice: new DicePanel(), blackjack: new BlackjackPanel(), liar: new LiarPanel() };

/**
 * 入座時浮在地圖上的遊戲畫面：標題、規則、誰坐在這桌、那種遊戲的畫面，以及離開的按鈕。
 * 遊戲區的內容交給 PANELS 裡對應的類別畫。
 */
export class TablePanel {
    private element = document.createElement("section");
    private room: Room<any, TownState>;
    /** 只有自己看得到的東西（伺服器私下送的）。 */
    private secret: unknown = null;
    /** 上次畫的內容；沒變就不重畫，按鈕的焦點和輸入框才不會一直被清掉。 */
    private shown = "";

    constructor(room: Room<any, TownState>) {
        this.room = room;
        this.element.className = "table-panel";
        this.element.hidden = true;
        this.element.setAttribute("aria-label", "遊戲桌");
        document.body.append(this.element);

        this.element.addEventListener("click", (e) => this.onClick(e.target as HTMLElement));
        // 點地圖（面板以外的地方）就離開面板裡的輸入框，鍵盤才能拿來走路
        document.addEventListener("pointerdown", (e) => {
            const active = document.activeElement as HTMLElement | null;
            if (active && this.element.contains(active) && !this.element.contains(e.target as Node)) active.blur();
        });
        room.onMessage("tablePrivate", ({ data }: { tableId: string; data: unknown }) => {
            this.secret = data;
            this.render(room.state);
        });
        room.onStateChange((state) => this.render(state));
    }

    private render(state: TownState) {
        const tableId = state.characters?.get(this.room.sessionId)?.seatedAt;
        const table = tableId ? state.tables.get(tableId) : undefined;
        const key = table ? JSON.stringify([table.game, Array.from(table.seats), table.view, this.secret]) : "";
        if (key === this.shown) return;
        this.shown = key;
        this.element.hidden = !table;
        if (!table || !table.view) return;

        const game = table.game as GameKind;
        const panel = PANELS[game];
        const nameOf = (sessionId: string) => state.characters.get(sessionId)?.name ?? "";
        const seated = Array.from(table.seats).filter((s) => s);
        const leave = Object.assign(el("button", "離開（E）") as HTMLButtonElement, { type: "button" });
        leave.dataset.leave = "true";
        this.element.replaceChildren(
            el("h2", `${GAME_ICONS[game]} ${GAME_TITLES[game]}`),
            el("p", panel.hint, "table-hint"),
            el("p", `同桌：${seated.map(nameOf).join("、")}`),
            ...panel.render(JSON.parse(table.view), { me: this.room.sessionId, nameOf, secret: this.secret }),
            leave,
        );
    }

    /** 按鈕：離開送 stand；遊戲動作送 tableAction，放在 .table-form 裡的話把數字欄位一起送。 */
    private onClick(target: HTMLElement) {
        if (target.dataset.leave) return this.room.send("stand");
        const action = target.dataset.action;
        if (!action) return;
        const payload: Record<string, unknown> = { action };
        for (const input of Array.from(target.closest(".table-form")?.querySelectorAll("input") ?? [])) payload[input.name] = Number(input.value);
        this.room.send("tableAction", payload);
    }
}
