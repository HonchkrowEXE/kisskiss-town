import { Callbacks, type Room } from "@colyseus/sdk";
import type { TownState } from "../../../server/src/rooms/schema/TownState.js";

/** 畫面左上角：自己的籌碼餘額、簽到和領救濟金的按鈕、「可被搧」的開關，以及伺服器回的結果。其他控制項（例如管理員設定）也放進這一列。 */
export class ChipHud {
    readonly element = document.createElement("div");
    private balance: HTMLSpanElement;
    private slappable: HTMLInputElement;
    private result: HTMLSpanElement;
    private clearTimer?: ReturnType<typeof setTimeout>;

    constructor(room: Room<any, TownState>) {
        this.element.className = "chip-hud";
        this.element.innerHTML = `
            <span class="chip-balance" role="status">籌碼 0</span>
            <button type="button" data-action="checkIn">簽到</button>
            <button type="button" data-action="claimRelief">領救濟金</button>
            <label class="slappable"><input type="checkbox" checked> 可被搧<span class="key-hint">（按 F 搧旁邊的人）</span></label>
            <span class="chip-result" role="status"></span>
        `;
        document.body.append(this.element);
        this.balance = this.element.querySelector(".chip-balance")!;
        this.slappable = this.element.querySelector(".slappable input")!;
        this.result = this.element.querySelector(".chip-result")!;

        this.element.addEventListener("click", (e) => {
            const action = (e.target as HTMLElement).dataset.action;
            if (action) room.send(action);
        });
        this.slappable.addEventListener("change", () => room.send("setSlappable", this.slappable.checked));
        room.onMessage("chipResult", (r: { ok: boolean; message: string }) => this.showResult(r));

        const callbacks = Callbacks.get(room);
        callbacks.onAdd("characters", (character, sessionId) => {
            if (sessionId !== room.sessionId) return;
            callbacks.listen(character, "chips", (chips) => (this.balance.textContent = `籌碼 ${chips}`), true);
            callbacks.listen(character, "slappable", (value) => (this.slappable.checked = value), true);
        });
    }

    private showResult({ ok, message }: { ok: boolean; message: string }) {
        this.result.textContent = message;
        this.result.classList.toggle("error", !ok);
        clearTimeout(this.clearTimer);
        this.clearTimer = setTimeout(() => (this.result.textContent = ""), 3000);
    }
}
