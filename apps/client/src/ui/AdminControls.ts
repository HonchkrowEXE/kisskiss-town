import { Callbacks, type Room } from "@colyseus/sdk";
import type { TownState } from "../../../server/src/rooms/schema/TownState.js";
import type { TownMapState } from "../../../server/src/town/layoutTown.js";
import { GAME_ICONS, GAME_KINDS, GAME_TITLES, type GameKind } from "../../../server/src/town/tables.js";

/**
 * 只有管理員看得到的設定（伺服器確認是管理員才會送 admin，每次改也會再確認）：
 * - 搧巴掌通知發在哪個文字頻道
 * - 遊戲桌：在自己站的地方放一張、把某張搬到自己站的地方、移除
 */
export class AdminControls {
    private room: Room<any, TownState>;
    /** 放控制項的那一列（籌碼列）。 */
    private bar: HTMLElement;
    private notifySelect = document.createElement("select");
    private gameSelect = document.createElement("select");
    private tableSelect = document.createElement("select");
    private result = Object.assign(document.createElement("span"), { className: "chip-result", role: "status" });
    private clearTimer?: ReturnType<typeof setTimeout>;

    constructor(room: Room<any, TownState>, bar: HTMLElement) {
        this.room = room;
        this.bar = bar;
        room.onMessage("admin", ({ notifyChannel }: { notifyChannel: string }) => this.show(notifyChannel));
        room.onMessage("adminResult", (r: { ok: boolean; message: string }) => this.showResult(r));
    }

    private show(notifyChannel: string) {
        const notify = Object.assign(document.createElement("label"), { className: "admin-notify", textContent: "巴掌通知發在 " });
        notify.append(this.notifySelect);
        this.notifySelect.addEventListener("change", () => this.room.send("setNotifyChannel", this.notifySelect.value));

        this.gameSelect.replaceChildren(...GAME_KINDS.map((g) => new Option(`${GAME_ICONS[g]} ${GAME_TITLES[g]}`, g)));
        const tables = Object.assign(document.createElement("span"), { className: "admin-tables", textContent: "遊戲桌 " });
        tables.append(
            this.gameSelect,
            this.button("放在我這裡", () => this.room.send("placeTable", { game: this.gameSelect.value })),
            this.tableSelect,
            this.button("搬到我這裡", () => this.room.send("moveTable", { tableId: this.tableSelect.value })),
            this.button("移除", () => this.room.send("removeTable", { tableId: this.tableSelect.value })),
        );
        this.bar.append(notify, tables, this.result);

        const callbacks = Callbacks.get(this.room);
        // 通知頻道的選項是小鎮上的文字房；頻道變動時跟著更新
        callbacks.listen("map", (json) => json && this.fillNotifyOptions(JSON.parse(json), this.notifySelect.value || notifyChannel), true);
        // 桌子清單跟著擺放、移除更新
        callbacks.onAdd("tables", () => queueMicrotask(() => this.fillTableOptions()));
        callbacks.onRemove("tables", () => queueMicrotask(() => this.fillTableOptions()));
    }

    private fillNotifyOptions(map: TownMapState, selected: string) {
        const options = [new Option("系統訊息頻道", "")];
        for (const r of map.rooms) if (r.kind === "text") options.push(new Option(`# ${r.name}`, r.id));
        this.notifySelect.replaceChildren(...options);
        this.notifySelect.value = options.some((o) => o.value === selected) ? selected : "";
    }

    private fillTableOptions() {
        const selected = this.tableSelect.value;
        const options: HTMLOptionElement[] = [];
        this.room.state.tables.forEach((t, id) => {
            const game = t.game as GameKind;
            options.push(new Option(`${GAME_ICONS[game]} ${GAME_TITLES[game]}（${Math.round(t.x / 16)}, ${Math.round(t.y / 16)}）`, id));
        });
        this.tableSelect.replaceChildren(...options);
        if (options.some((o) => o.value === selected)) this.tableSelect.value = selected;
    }

    private button(text: string, onClick: () => void) {
        const b = Object.assign(document.createElement("button"), { type: "button", textContent: text });
        b.addEventListener("click", onClick);
        return b;
    }

    private showResult({ ok, message }: { ok: boolean; message: string }) {
        this.result.textContent = message;
        this.result.classList.toggle("error", !ok);
        clearTimeout(this.clearTimer);
        this.clearTimer = setTimeout(() => (this.result.textContent = ""), 3000);
    }
}
