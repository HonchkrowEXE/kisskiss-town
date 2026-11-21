import type { Room } from "@colyseus/sdk";
import type { TownState } from "../../server/src/rooms/schema/TownState.js";

/** 搖桿推到底時手指離中心多遠（像素）；推不到底就走得比較慢。 */
const RADIUS = 48;

/** 手機上的操作：左下角虛擬搖桿走路，右下角搧巴掌、入座／起身的按鈕。只在觸控螢幕上顯示。 */
export function mountTouchControls(room: Room<any, TownState>) {
    /** 搖桿目前的方向，長度 0～1。 */
    const stick = { dx: 0, dy: 0 };
    if (!matchMedia("(pointer: coarse)").matches) return stick;

    const pad = document.createElement("div");
    pad.className = "touch-stick";
    pad.setAttribute("aria-hidden", "true"); // 鍵盤和螢幕閱讀器用方向鍵，不需要這個
    const knob = pad.appendChild(document.createElement("div"));
    const buttons = document.createElement("div");
    buttons.className = "touch-buttons";
    buttons.innerHTML = `<button type="button" data-action="slap">搧</button><button type="button" data-action="sit">坐／起</button>`;
    document.body.append(pad, buttons);

    const move = (e: PointerEvent) => {
        const rect = pad.getBoundingClientRect();
        let dx = (e.clientX - (rect.left + rect.width / 2)) / RADIUS;
        let dy = (e.clientY - (rect.top + rect.height / 2)) / RADIUS;
        const length = Math.hypot(dx, dy);
        if (length > 1) [dx, dy] = [dx / length, dy / length];
        if (length < 0.2) [dx, dy] = [0, 0]; // 中間一小圈不動，手指輕碰不會亂走
        Object.assign(stick, { dx, dy });
        knob.style.transform = `translate(${dx * RADIUS}px, ${dy * RADIUS}px)`;
    };
    const release = () => {
        Object.assign(stick, { dx: 0, dy: 0 });
        knob.style.transform = "";
    };
    pad.addEventListener("pointerdown", (e) => {
        pad.setPointerCapture(e.pointerId);
        move(e);
    });
    pad.addEventListener("pointermove", (e) => pad.hasPointerCapture(e.pointerId) && move(e));
    pad.addEventListener("pointerup", release);
    pad.addEventListener("pointercancel", release);

    buttons.addEventListener("click", (e) => {
        const action = (e.target as HTMLElement).dataset.action;
        if (action === "slap") room.send("slap");
        if (action === "sit") room.send(room.state.characters?.get(room.sessionId)?.seatedAt ? "stand" : "sit");
    });
    return stick;
}
