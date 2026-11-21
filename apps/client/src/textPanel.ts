import type { Room } from "@colyseus/sdk";
import type { TownState } from "../../server/src/rooms/schema/TownState.js";
import type { TownMessage } from "../../server/src/platform/platform.js";

type Panel = { channelId: string; name: string; messages: TownMessage[]; notice: string | null } | null;

/** 一次最多留幾則訊息在畫面上，太舊的拿掉。 */
const KEEP = 50;

/** 正在打字（焦點在文字輸入框）時，鍵盤不能拿來走路或按快捷鍵。 */
export const isTyping = () => {
    const el = document.activeElement;
    return el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && el.type === "text");
};

/** 站在文字房裡時，畫面右側顯示那個頻道的訊息和輸入框；離開房間時收起。 */
export function mountTextPanel(room: Room<any, TownState>) {
    const panel = document.createElement("section");
    panel.className = "text-panel";
    panel.hidden = true;
    panel.innerHTML = `
        <h2></h2>
        <p class="text-notice" role="status"></p>
        <ol class="text-messages" aria-live="polite"></ol>
        <form class="text-form">
            <input type="text" maxlength="2000" autocomplete="off" aria-label="訊息">
            <button type="submit">送出</button>
        </form>
        <p class="text-result" role="status"></p>
    `;
    document.body.append(panel);
    const title = panel.querySelector("h2")!;
    const notice = panel.querySelector<HTMLParagraphElement>(".text-notice")!;
    const list = panel.querySelector("ol")!;
    const form = panel.querySelector("form")!;
    const input = form.querySelector("input")!;
    const result = panel.querySelector<HTMLParagraphElement>(".text-result")!;
    let channelId = "";

    function add(message: TownMessage) {
        // 名字和內容都是成員寫的，一律用 textContent
        const item = document.createElement("li");
        const author = Object.assign(document.createElement("b"), { textContent: message.author });
        item.append(author, `：${message.content}`);
        list.append(item);
        while (list.children.length > KEEP) list.firstElementChild!.remove();
        list.scrollTop = list.scrollHeight;
    }

    room.onMessage("textRoom", (p: Panel) => {
        panel.hidden = !p;
        result.textContent = "";
        if (!p) {
            channelId = "";
            input.blur(); // 離開房間就把鍵盤還給走路
            return;
        }
        channelId = p.channelId;
        title.textContent = `# ${p.name}`;
        notice.textContent = p.notice ?? "";
        notice.hidden = !p.notice;
        list.replaceChildren();
        p.messages.forEach(add);
    });
    room.onMessage("textMessage", (m: { channelId: string; message: TownMessage }) => m.channelId === channelId && add(m.message));
    room.onMessage("textResult", (r: { message: string }) => (result.textContent = r.message));

    form.addEventListener("submit", (e) => {
        e.preventDefault();
        if (!input.value.trim()) return;
        room.send("say", input.value);
        input.value = "";
        result.textContent = "";
    });
    // Esc 離開輸入框，回去走路
    input.addEventListener("keydown", (e) => e.key === "Escape" && input.blur());
    // 點地圖（面板以外的地方）也離開輸入框：畫布不會搶走焦點，不這樣做的話點了地圖還是不能走
    document.addEventListener("pointerdown", (e) => !panel.contains(e.target as Node) && input.blur());
}
