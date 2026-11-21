import type { Room } from "@colyseus/sdk";
import type { TownState } from "../../../server/src/rooms/schema/TownState.js";

type Result = { ok: boolean; message: string };

/** 伺服器回的這些結果會短暫顯示在畫面上方。加新的結果訊息就加在這裡。 */
const TOAST_MESSAGES = [
    "voiceMove", // 走進語音房後：切過去了、要先加入語音、bot 權限不夠
    "slapResult", // 搧巴掌：命中、冷卻中、對方關掉了
    "tableResult", // 遊戲桌：入座、下注、籌碼不夠
];

/** 畫面上方短暫顯示的提示，成功是綠色、失敗是紅色，4 秒後消失。 */
export class Toast {
    private element = Object.assign(document.body.appendChild(document.createElement("div")), { className: "toast", hidden: true, role: "status" });
    private timer?: ReturnType<typeof setTimeout>;

    constructor(room: Room<any, TownState>) {
        for (const type of TOAST_MESSAGES) room.onMessage(type, (result: Result) => this.show(result));
    }

    show({ ok, message }: Result) {
        this.element.textContent = message;
        this.element.classList.toggle("error", !ok);
        this.element.hidden = false;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => (this.element.hidden = true), 4000);
    }
}
