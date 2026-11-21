import { Callbacks, type Room } from "@colyseus/sdk";
import type { TownState } from "../../../server/src/rooms/schema/TownState.js";
import type { TownMapState } from "../../../server/src/town/layoutTown.js";

/** 只有管理員看得到：選搧巴掌通知發在哪個文字頻道。伺服器每次改都會再確認是不是管理員。 */
export class AdminControls {
    private select = document.createElement("select");
    private result = Object.assign(document.createElement("span"), { className: "chip-result", role: "status" });
    private clearTimer?: ReturnType<typeof setTimeout>;

    private room: Room<any, TownState>;
    /** 放控制項的那一列（籌碼列）。 */
    private bar: HTMLElement;

    constructor(room: Room<any, TownState>, bar: HTMLElement) {
        this.room = room;
        this.bar = bar;
        // 伺服器確認是管理員才會送 admin，一般成員不會看到選單
        room.onMessage("admin", ({ notifyChannel }: { notifyChannel: string }) => this.show(notifyChannel));
        room.onMessage("adminResult", (r: { ok: boolean; message: string }) => this.showResult(r));
        this.select.addEventListener("change", () => room.send("setNotifyChannel", this.select.value));
    }

    private show(notifyChannel: string) {
        const label = Object.assign(document.createElement("label"), { className: "admin-notify", textContent: "巴掌通知發在 " });
        label.append(this.select);
        this.bar.append(label, this.result);
        // 選項是小鎮上的文字房；頻道變動時跟著更新
        Callbacks.get(this.room).listen("map", (json) => json && this.fillOptions(JSON.parse(json), this.select.value || notifyChannel), true);
    }

    private fillOptions(map: TownMapState, selected: string) {
        const options = [new Option("系統訊息頻道", "")];
        for (const r of map.rooms) if (r.kind === "text") options.push(new Option(`# ${r.name}`, r.id));
        this.select.replaceChildren(...options);
        this.select.value = options.some((o) => o.value === selected) ? selected : "";
    }

    private showResult({ ok, message }: { ok: boolean; message: string }) {
        this.result.textContent = message;
        this.result.classList.toggle("error", !ok);
        clearTimeout(this.clearTimer);
        this.clearTimer = setTimeout(() => (this.result.textContent = ""), 3000);
    }
}
