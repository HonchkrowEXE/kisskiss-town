import type { Room } from "@colyseus/sdk";
import type { TownState } from "../../server/src/rooms/schema/TownState.js";
import { DICE_STAKE } from "../../server/src/games/diceDuel.js";

type ResultRow = { name: string; dice: [number, number]; delta: number };

/** 入座時浮在地圖上的遊戲畫面：誰坐在這桌、誰下注了、上一局結果，以及下注、擲骰、離開的按鈕。 */
export function mountTablePanel(room: Room<any, TownState>) {
    const panel = document.createElement("section");
    panel.className = "table-panel";
    panel.hidden = true;
    panel.setAttribute("aria-label", "遊戲桌");
    document.body.append(panel);

    panel.addEventListener("click", (e) => {
        const action = (e.target as HTMLElement).dataset.action;
        if (action) room.send(action);
    });

    let shown = "";
    room.onStateChange((state) => {
        const tableId = state.characters?.get(room.sessionId)?.seatedAt;
        const table = tableId ? state.tables.get(tableId) : undefined;
        const nameOf = (sessionId: string) => state.characters.get(sessionId)?.name ?? "";
        const view = table && {
            seats: table.seats.filter((s) => s).map((s) => ({ name: nameOf(s), bet: table.bettors.includes(s) })),
            bet: table.bettors.includes(room.sessionId),
            result: table.result ? (JSON.parse(table.result) as ResultRow[]) : [],
        };
        // 狀態每次同步都會呼叫；內容沒變就不重畫，按鈕的焦點才不會一直跑掉
        const key = JSON.stringify(view ?? null);
        if (key === shown) return;
        shown = key;
        panel.hidden = !view;
        if (!view) return;

        // 名字是成員自己取的，一律用 textContent，不拼 HTML
        const el = (tag: string, text = "", className = "") => Object.assign(document.createElement(tag), { textContent: text, className });
        const button = (action: string, text: string, disabled = false) => {
            const b = Object.assign(el("button", text) as HTMLButtonElement, { type: "button", disabled });
            b.dataset.action = action;
            return b;
        };
        const seats = el("ul", "", "table-seats");
        for (const s of view.seats) seats.append(el("li", s.bet ? `${s.name} ✅ 已下注` : s.name));
        const actions = el("div", "", "table-actions");
        actions.append(button("bet", `下注 ${DICE_STAKE}`, view.bet), button("roll", "擲骰", !view.bet), button("stand", "離開（E）"));
        const children: Node[] = [el("h2", `🎲 骰子比大小・每局 ${DICE_STAKE} 籌碼`), seats, actions];
        if (view.result.length) {
            const result = el("ul", "", "table-result");
            for (const r of view.result) {
                result.append(el("li", `${r.name}：${r.dice[0]} + ${r.dice[1]} = ${r.dice[0] + r.dice[1]}，${r.delta > 0 ? "+" : ""}${r.delta}`));
            }
            children.push(el("p", "上一局"), result);
        }
        panel.replaceChildren(...children);
    });
}
