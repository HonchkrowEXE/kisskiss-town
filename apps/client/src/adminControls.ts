import { Callbacks, type Room } from "@colyseus/sdk";
import type { TownState } from "../../server/src/rooms/schema/TownState.js";
import type { TownMapState } from "../../server/src/town/layoutTown.js";

/** 只有管理員看得到：選搧巴掌通知發在哪個文字頻道。伺服器每次改都會再確認是不是管理員。 */
export function mountAdminControls(room: Room<any, TownState>) {
    room.onMessage("admin", ({ notifyChannel }: { notifyChannel: string }) => {
        const label = document.createElement("label");
        label.className = "admin-notify";
        label.textContent = "巴掌通知發在 ";
        const select = label.appendChild(document.createElement("select"));
        const result = Object.assign(document.createElement("span"), { className: "chip-result", role: "status" });
        (document.querySelector(".chip-hud") ?? document.body).append(label, result);

        // 選項是小鎮上的文字房；頻道變動時跟著更新
        Callbacks.get(room).listen("map", (json) => {
            if (!json) return;
            const current = select.value || notifyChannel;
            const options = [new Option("系統訊息頻道", "")];
            for (const r of (JSON.parse(json) as TownMapState).rooms) {
                if (r.kind === "text") options.push(new Option(`# ${r.name}`, r.id));
            }
            select.replaceChildren(...options);
            select.value = options.some((o) => o.value === current) ? current : "";
        }, true);

        select.addEventListener("change", () => room.send("setNotifyChannel", select.value));
        let clearTimer: ReturnType<typeof setTimeout> | undefined;
        room.onMessage("adminResult", ({ ok, message }: { ok: boolean; message: string }) => {
            result.textContent = message;
            result.classList.toggle("error", !ok);
            clearTimeout(clearTimer);
            clearTimer = setTimeout(() => (result.textContent = ""), 3000);
        });
    });
}
