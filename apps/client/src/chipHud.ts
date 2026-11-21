import { Callbacks, type Room } from "@colyseus/sdk";
import type { TownState } from "../../server/src/rooms/schema/TownState.js";

/** 畫面左上角：自己的籌碼餘額、簽到和領救濟金的按鈕、「可被搧」的開關，以及伺服器回的結果。 */
export function mountChipHud(room: Room<any, TownState>) {
    const hud = document.createElement("div");
    hud.className = "chip-hud";
    hud.innerHTML = `
        <span class="chip-balance" role="status">籌碼 0</span>
        <button type="button" data-action="checkIn">簽到</button>
        <button type="button" data-action="claimRelief">領救濟金</button>
        <label class="slappable"><input type="checkbox" checked> 可被搧<span class="key-hint">（按 F 搧旁邊的人）</span></label>
        <span class="chip-result" role="status"></span>
    `;
    document.body.append(hud);

    const balance = hud.querySelector<HTMLSpanElement>(".chip-balance")!;
    const result = hud.querySelector<HTMLSpanElement>(".chip-result")!;
    const slappable = hud.querySelector<HTMLInputElement>(".slappable input")!;
    slappable.addEventListener("change", () => room.send("setSlappable", slappable.checked));

    hud.addEventListener("click", (e) => {
        const action = (e.target as HTMLElement).dataset.action;
        if (action) room.send(action);
    });

    let clearTimer: ReturnType<typeof setTimeout> | undefined;
    room.onMessage("chipResult", ({ ok, message }: { ok: boolean; message: string }) => {
        result.textContent = message;
        result.classList.toggle("error", !ok);
        clearTimeout(clearTimer);
        clearTimer = setTimeout(() => (result.textContent = ""), 3000);
    });

    const callbacks = Callbacks.get(room);
    callbacks.onAdd("characters", (character, sessionId) => {
        if (sessionId !== room.sessionId) return;
        callbacks.listen(character, "chips", (chips) => (balance.textContent = `籌碼 ${chips}`), true);
        callbacks.listen(character, "slappable", (value) => (slappable.checked = value), true);
    });
}
