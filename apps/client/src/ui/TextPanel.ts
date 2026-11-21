import type { Room } from "@colyseus/sdk";
import type { TownState } from "../../../server/src/rooms/schema/TownState.js";
import type { TownMessage } from "../../../server/src/platform/platform.js";

type Panel = { channelId: string; name: string; messages: TownMessage[]; notice: string | null } | null;

/** 一次最多留幾則訊息在畫面上，太舊的拿掉。 */
const KEEP = 50;

/** 站在文字房裡時，畫面右側顯示那個頻道的訊息和輸入框；離開房間時收起。 */
export class TextPanel {
    private element = document.createElement("section");
    private title: HTMLHeadingElement;
    private notice: HTMLParagraphElement;
    private list: HTMLOListElement;
    private input: HTMLInputElement;
    private result: HTMLParagraphElement;
    /** 現在顯示的頻道；收到別的頻道的訊息就不理。 */
    private channelId = "";

    constructor(room: Room<any, TownState>) {
        this.element.className = "text-panel";
        this.element.hidden = true;
        this.element.innerHTML = `
            <h2></h2>
            <p class="text-notice" role="status"></p>
            <ol class="text-messages" aria-live="polite"></ol>
            <form class="text-form">
                <input type="text" maxlength="2000" autocomplete="off" aria-label="訊息">
                <button type="submit">送出</button>
            </form>
            <p class="text-result" role="status"></p>
        `;
        document.body.append(this.element);
        this.title = this.element.querySelector("h2")!;
        this.notice = this.element.querySelector(".text-notice")!;
        this.list = this.element.querySelector("ol")!;
        this.input = this.element.querySelector("input")!;
        this.result = this.element.querySelector(".text-result")!;

        room.onMessage("textRoom", (panel: Panel) => this.open(panel));
        room.onMessage("textMessage", (m: { channelId: string; message: TownMessage }) => m.channelId === this.channelId && this.add(m.message));
        room.onMessage("textResult", (r: { message: string }) => (this.result.textContent = r.message));

        this.element.querySelector("form")!.addEventListener("submit", (e) => {
            e.preventDefault();
            if (!this.input.value.trim()) return;
            room.send("say", this.input.value);
            this.input.value = "";
            this.result.textContent = "";
        });
        // Esc 離開輸入框，回去走路
        this.input.addEventListener("keydown", (e) => e.key === "Escape" && this.input.blur());
        // 點地圖（面板以外的地方）也離開輸入框：畫布不會搶走焦點，不這樣做的話點了地圖還是不能走
        document.addEventListener("pointerdown", (e) => !this.element.contains(e.target as Node) && this.input.blur());
    }

    /** 走進文字房時打開（給 null 就收起）。 */
    private open(panel: Panel) {
        this.element.hidden = !panel;
        this.result.textContent = "";
        if (!panel) {
            this.channelId = "";
            this.input.blur(); // 離開房間就把鍵盤還給走路
            return;
        }
        this.channelId = panel.channelId;
        this.title.textContent = `# ${panel.name}`;
        this.notice.textContent = panel.notice ?? "";
        this.notice.hidden = !panel.notice;
        this.list.replaceChildren();
        panel.messages.forEach((m) => this.add(m));
    }

    private add(message: TownMessage) {
        // 名字和內容都是成員寫的，一律用 textContent
        const item = document.createElement("li");
        item.append(Object.assign(document.createElement("b"), { textContent: message.author }), `：${message.content}`);
        this.list.append(item);
        while (this.list.children.length > KEEP) this.list.firstElementChild!.remove();
        this.list.scrollTop = this.list.scrollHeight;
    }
}
