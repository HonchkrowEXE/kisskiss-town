import type { Room } from "@colyseus/sdk";

/** 斷線時在畫面最上方提示。SDK 會自己試著重連，重連失敗才會 onLeave。 */
export class ConnectionNotice {
    private element = Object.assign(document.body.appendChild(document.createElement("div")), { className: "notice", hidden: true });

    constructor(room: Room) {
        room.onDrop(() => this.show("連線中斷，重新連線中…"));
        room.onReconnect(() => this.show(""));
        room.onError((code, message) => this.show(`小鎮出錯了（${code}）：${message ?? ""}`));
        room.onLeave(() => this.show("和小鎮的連線中斷了，請關掉親親小鎮再打開"));
    }

    /** 顯示提示；給空字串就藏起來。 */
    private show(text: string) {
        this.element.textContent = text;
        this.element.hidden = text === "";
    }
}
