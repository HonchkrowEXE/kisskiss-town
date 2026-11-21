import type { Room } from "@colyseus/sdk";
import type { TownState } from "../../../server/src/rooms/schema/TownState.js";
import type { TownMapState } from "../../../server/src/town/layoutTown.js";
import { isObjectKind, roomOfObject, type BoardPost, type ObjectKind } from "../../../server/src/town/objects.js";
import { discordSDK } from "../discord.js";

/** 名字、標題都是成員寫的，一律用 textContent，不拼 HTML。 */
const el = (tag: string, text = "", className = "") => Object.assign(document.createElement(tag), { textContent: text, className });
const button = (text: string, onClick: () => void, disabled = false) => {
    const b = Object.assign(document.createElement("button"), { type: "button", textContent: text, disabled });
    b.addEventListener("click", onClick);
    return b;
};

/** 打開外部連結：在 Discord 裡要經過 SDK（會跳出 Discord 的確認），一般瀏覽器開新分頁。 */
function openLink(url: string) {
    if (location.hostname.endsWith("discordsays.com")) void discordSDK.commands.openExternalLink({ url });
    else window.open(url, "_blank", "noopener");
}

/** 一種家具的互動畫面。加新的互動家具就寫一個類別，在 FurniturePanel 的 VIEWS 加一行。 */
interface FurnitureView {
    title: string;
    render(id: string, room: Room<any, TownState>): Node[];
}

/** 電腦：揪團看板。貼遊戲房間的連結（例如 Riot 遊戲的組隊邀請），大家點「加入」就打開。 */
class ComputerView implements FurnitureView {
    title = "💻 揪團電腦";

    render(id: string, room: Room<any, TownState>) {
        const posts = JSON.parse(room.state.objects.get(id)?.board ?? "[]") as BoardPost[];
        const me = room.state.characters.get(room.sessionId)?.userId;
        const list = el("ul", "", "board-posts");
        for (const p of [...posts].reverse()) {
            const item = el("li");
            item.append(el("b", p.title), el("span", `　${p.by}`), button("加入", () => openLink(p.url)));
            if (p.userId === me) item.append(button("刪除", () => room.send("removeBoardPost", { id, at: p.at })));
            list.append(item);
        }
        const form = el("form", "", "board-form") as HTMLFormElement;
        const title = Object.assign(document.createElement("input"), { type: "text", placeholder: "例如：積分缺一、ARAM 缺二", maxLength: 40 });
        const url = Object.assign(document.createElement("input"), { type: "url", placeholder: "遊戲房間或組隊邀請的連結 https://…", maxLength: 300 });
        title.setAttribute("aria-label", "標題");
        url.setAttribute("aria-label", "連結");
        form.append(title, url, Object.assign(document.createElement("button"), { type: "submit", textContent: "貼上" }));
        form.addEventListener("submit", (e) => {
            e.preventDefault();
            room.send("postBoard", { id, title: title.value, url: url.value });
            title.value = "";
            url.value = "";
        });
        return [posts.length ? list : el("p", "還沒有人揪團，貼一個吧！"), form];
    }
}

/** 電視：這個語音房裡誰在直播；「去看直播」把自己搬進語音頻道，在 Discord 點直播畫面就能看。 */
class TvView implements FurnitureView {
    title = "📺 電視";

    render(id: string, room: Room<any, TownState>) {
        const o = room.state.objects.get(id);
        const layout = JSON.parse(room.state.map) as TownMapState;
        const where = o && isObjectKind(o.kind) ? roomOfObject({ id, kind: o.kind, x: o.x, y: o.y }, layout) : undefined;
        if (where?.kind !== "voice") return [el("p", "這台電視不在語音房裡，搬到客廳（語音房）才能看直播。")];
        const streamers: string[] = [];
        room.state.voice?.forEach((v) => v.channelId === where.id && v.streaming && streamers.push(v.name));
        const nodes: Node[] = [el("p", `頻道：🔊 ${where.name}`)];
        if (streamers.length) {
            const list = el("ul", "", "tv-streamers");
            for (const name of streamers) list.append(el("li", `🔴 ${name} 正在直播`));
            nodes.push(list);
        } else {
            nodes.push(el("p", "現在沒有人直播"));
        }
        nodes.push(button("去看直播", () => room.send("watchTv", { id }), !streamers.length));
        return nodes;
    }
}

const VIEWS: Partial<Record<ObjectKind, FurnitureView>> = { computer: new ComputerView(), tv: new TvView() };

/** 按 E 打開的家具畫面（電腦、電視）。狀態變了就重畫；按關閉或 Esc 收起。 */
export class FurniturePanel {
    private element = document.createElement("section");
    private open?: { id: string; view: FurnitureView };
    private shown = "";

    constructor(room: Room<any, TownState>) {
        this.element.className = "furniture-panel";
        this.element.hidden = true;
        document.body.append(this.element);

        room.onMessage("openObject", ({ id, kind }: { id: string; kind: ObjectKind }) => {
            const view = VIEWS[kind];
            if (!view) return;
            this.open = { id, view };
            this.shown = "";
            this.render(room);
        });
        room.onMessage("boardResult", ({ ok, message }: { ok: boolean; message: string }) => {
            const result = this.element.querySelector(".furniture-result");
            if (result) Object.assign(result, { textContent: message, className: `furniture-result${ok ? "" : " error"}` });
        });
        room.onStateChange(() => this.render(room));
        document.addEventListener("keydown", (e) => e.key === "Escape" && this.close());
    }

    private render(room: Room<any, TownState>) {
        if (!this.open) return;
        if (!room.state.objects.has(this.open.id)) return this.close(); // 家具被移除了
        const o = room.state.objects.get(this.open.id)!;
        // 只有內容變了才重畫，輸入框裡打到一半的字才不會被清掉
        const key = JSON.stringify([this.open.id, o.board, room.state.map.length, Array.from(room.state.voice?.values() ?? []).map((v) => [v.channelId, v.streaming, v.name])]);
        if (key === this.shown) return;
        this.shown = key;
        this.element.replaceChildren(
            el("h2", this.open.view.title),
            ...this.open.view.render(this.open.id, room),
            el("p", "", "furniture-result"),
            button("關閉", () => this.close()),
        );
        this.element.hidden = false;
    }

    private close() {
        this.open = undefined;
        this.element.hidden = true;
    }
}
