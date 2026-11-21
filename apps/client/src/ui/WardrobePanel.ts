import { Callbacks, type Client, type Room } from "@colyseus/sdk";
import type { TownState } from "../../../server/src/rooms/schema/TownState.js";
import {
    BOTTOM_STYLES, CLOTH_COLORS, HAIR_COLORS, HAIR_STYLES, SKIN_TONES, TOP_STYLES, appearanceFromJson, type Appearance,
} from "../../../server/src/town/appearance.js";
import { ART_CREDITS, drawCharacter } from "../scene/characterArt.js";

/** 預覽放大幾倍。 */
const PREVIEW_SCALE = 4;

/** 換裝畫面的每個欄位：標籤和選項（值 → 顯示的字）。 */
const FIELDS: { field: keyof Appearance; label: string; options: Record<string, string> }[] = [
    { field: "hair", label: "髮型", options: HAIR_STYLES },
    { field: "hairColor", label: "髮色", options: names(HAIR_COLORS) },
    { field: "skin", label: "膚色", options: names(SKIN_TONES) },
    { field: "top", label: "上衣", options: TOP_STYLES },
    { field: "topColor", label: "上衣顏色", options: names(CLOTH_COLORS) },
    { field: "bottom", label: "下身", options: BOTTOM_STYLES },
    { field: "bottomColor", label: "下身顏色", options: names(CLOTH_COLORS) },
    { field: "shoesColor", label: "鞋子顏色", options: names(CLOTH_COLORS) },
];

/** 顏色表的名稱就是要顯示的字。 */
function names(colors: object) {
    return Object.fromEntries(Object.keys(colors).map((name) => [name, name]));
}

/**
 * 換裝和製作名單：
 * - 籌碼列多兩個按鈕「換裝」「製作名單」
 * - 換裝畫面：選部件和顏色，四個方向即時預覽，存檔後大家看到新外觀
 * - 製作名單：所有部件的作者與授權（ADR-0007）
 */
export class WardrobePanel {
    private room: Room<any, TownState>;
    private panel = document.createElement("section");
    private credits = document.createElement("section");
    private preview = document.createElement("canvas");
    private selects = new Map<keyof Appearance, HTMLSelectElement>();
    private result = document.createElement("p");

    private http: Client["http"];

    /** http：送照片用（在 Discord 裡會自動走 URL Mapping 代理，並帶上登入的 token）。 */
    constructor(room: Room<any, TownState>, bar: HTMLElement, http: Client["http"]) {
        this.room = room;
        this.http = http;
        bar.append(this.button("換裝", () => this.open()), this.button("製作名單", () => (this.credits.hidden = !this.credits.hidden)));
        this.buildPanel();
        this.buildCredits();
        room.onMessage("wardrobeResult", ({ ok, message }: { ok: boolean; message: string }) => {
            this.result.textContent = message;
            this.result.classList.toggle("error", !ok);
            if (ok) this.panel.hidden = true;
        });
        // 自己的外觀被別的分頁改了，換裝畫面開著時跟著更新
        const callbacks = Callbacks.get(room);
        callbacks.onAdd("characters", (character, sessionId) => {
            if (sessionId === room.sessionId) callbacks.listen(character, "look", () => !this.panel.hidden && this.open());
        });
    }

    /** 打開換裝畫面，從自己現在的外觀開始。 */
    private open() {
        const look = appearanceFromJson(this.room.state.characters.get(this.room.sessionId)?.look ?? "");
        for (const [field, select] of this.selects) select.value = look[field];
        this.result.textContent = "";
        this.panel.hidden = false;
        this.drawPreview();
    }

    private current(): Appearance {
        return Object.fromEntries([...this.selects].map(([field, select]) => [field, select.value])) as Appearance;
    }

    /** 四個方向並排預覽。 */
    private drawPreview() {
        const ctx = this.preview.getContext("2d")!;
        ctx.clearRect(0, 0, this.preview.width, this.preview.height);
        for (let dir = 0; dir < 4; dir++) drawCharacter(ctx, this.current(), dir, 0, dir * 16 * PREVIEW_SCALE, 0, PREVIEW_SCALE);
    }

    private buildPanel() {
        this.panel.className = "wardrobe-panel";
        this.panel.hidden = true;
        this.panel.setAttribute("aria-label", "換裝");
        this.preview.width = 4 * 16 * PREVIEW_SCALE;
        this.preview.height = 16 * PREVIEW_SCALE;
        this.preview.setAttribute("role", "img");
        this.preview.setAttribute("aria-label", "角色預覽：朝下、朝左、朝右、朝上");

        const form = document.createElement("div");
        form.className = "wardrobe-fields";
        for (const { field, label, options } of FIELDS) {
            const wrap = Object.assign(document.createElement("label"), { textContent: label });
            const select = document.createElement("select");
            select.append(...Object.entries(options).map(([value, text]) => new Option(text, value)));
            select.addEventListener("change", () => this.drawPreview());
            wrap.append(select);
            form.append(wrap);
            this.selects.set(field, select);
        }
        const actions = document.createElement("div");
        actions.className = "table-actions";
        actions.append(
            this.button("存檔", () => this.room.send("setLook", this.current())),
            this.button("取消", () => (this.panel.hidden = true)),
        );
        this.result.className = "chip-result";
        this.panel.append(Object.assign(document.createElement("h2"), { textContent: "換裝" }), this.preview, form, this.buildPhoto(), actions, this.result);
        document.body.append(this.panel);
    }

    /** 用照片生成：選照片前先告知會送到 Anthropic；結果填進上面的選單，成員可以再改再存檔。 */
    private buildPhoto() {
        const box = document.createElement("div");
        box.className = "photo-look";
        const notice = Object.assign(document.createElement("p"), {
            textContent: "用照片生成：照片會送到 Anthropic 的 Claude 判斷髮型和衣服顏色，處理完不會存在親親小鎮的伺服器（Anthropic 依它的政策最多保留 30 天）。",
        });
        const label = Object.assign(document.createElement("label"), { textContent: "選一張照片 " });
        const input = Object.assign(document.createElement("input"), { type: "file", accept: "image/jpeg,image/png,image/webp,image/gif" });
        const status = Object.assign(document.createElement("p"), { className: "chip-result", role: "status" });
        label.append(input);
        box.append(notice, label, status);

        input.addEventListener("change", async () => {
            const file = input.files?.[0];
            input.value = ""; // 同一張可以再選一次
            if (!file) return;
            if (file.size > 5 * 1024 * 1024) return this.say(status, false, "照片太大了，請選 5 MB 以下的");
            this.say(status, true, "判斷中…");
            try {
                const base64 = await this.readBase64(file);
                const { data } = await this.http.post("/photo_look", { body: { mediaType: file.type, base64 } });
                for (const [field, select] of this.selects) select.value = data.appearance[field];
                this.drawPreview();
                this.say(status, true, "依照片選好了，可以再調整，滿意就按存檔");
            } catch (e) {
                this.say(status, false, (e as { data?: { error?: string } }).data?.error ?? "暫時沒辦法用照片生成，請手動選部件");
            }
        });
        return box;
    }

    private say(element: HTMLElement, ok: boolean, message: string) {
        element.textContent = message;
        element.classList.toggle("error", !ok);
    }

    /** 照片轉成 base64（不含 data: 開頭）。只在瀏覽器記憶體裡，不存起來。 */
    private readBase64(file: File) {
        return new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
        });
    }

    private buildCredits() {
        this.credits.className = "wardrobe-panel";
        this.credits.hidden = true;
        this.credits.setAttribute("aria-label", "製作名單");
        const list = document.createElement("ul");
        for (const c of ART_CREDITS) list.append(Object.assign(document.createElement("li"), { textContent: `${c.parts}：${c.author}，${c.license}` }));
        this.credits.append(
            Object.assign(document.createElement("h2"), { textContent: "製作名單" }),
            list,
            this.button("關閉", () => (this.credits.hidden = true)),
        );
        document.body.append(this.credits);
    }

    private button(text: string, onClick: () => void) {
        const b = Object.assign(document.createElement("button"), { type: "button", textContent: text });
        b.addEventListener("click", onClick);
        return b;
    }
}
