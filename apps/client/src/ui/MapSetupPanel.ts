import type { Client, Room } from "@colyseus/sdk";
import type { TownState } from "../../../server/src/rooms/schema/TownState.js";
import { MAX_PROMPT, type TownMapState } from "../../../server/src/town/layoutTown.js";
import { exportMap } from "../../../server/src/town/exportMap.js";

/** 名字、訊息都可能是別人寫的，一律用 textContent，不拼 HTML。 */
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}): HTMLElementTagNameMap[K] =>
    Object.assign(document.createElement(tag), props);

/**
 * 小鎮地圖（只有管理員看得到；伺服器每次換地圖都會再確認是不是管理員）：
 * - 照頻道自動產生（依 Discord 分類分區）
 * - 請 Claude 依頻道和一段描述設計
 * - 匯入 Tiled／tilemap.dev 的地圖檔
 * - 匯出目前的地圖（Tiled JSON 加圖塊圖片），拿去 Tiled 改完再匯入
 * 新伺服器的管理員第一次進來（還沒選過地圖）會自動打開，選一種之後就不會再跳。
 */
export class MapSetupPanel {
    private room: Room<any, TownState>;
    private http: Client["http"];
    private panel = el("section", { className: "map-panel", hidden: true });
    private title = el("h2");
    private intro = el("p", { className: "map-intro" });
    private prompt = el("textarea", { maxLength: MAX_PROMPT, rows: 3, placeholder: "例如：像一間咖啡廳，語音房放最前面當包廂，文字房放後面當書房" });
    private files = el("input", { type: "file", multiple: true, accept: ".json,.tmj,image/png,image/jpeg,image/gif,image/webp" });
    private result = el("p", { className: "chip-result", role: "status" });
    private closeButton = el("button", { type: "button" });
    private busy: HTMLButtonElement[] = [];
    /** 第一次進來的歡迎版：關掉等於選「照頻道自動產生」。 */
    private welcome = false;

    /** http：送地圖用（在 Discord 裡會自動走 URL Mapping 代理，並帶上登入的 token）。 */
    constructor(room: Room<any, TownState>, bar: HTMLElement, http: Client["http"]) {
        this.room = room;
        this.http = http;
        this.build();
        room.onMessage("admin", ({ mapChosen }: { mapChosen?: boolean }) => {
            bar.append(this.button("地圖", () => this.open(false)));
            if (mapChosen === false) this.open(true);
        });
    }

    private open(welcome: boolean) {
        this.welcome = welcome;
        this.title.textContent = welcome ? "新的小鎮！先選一張地圖" : "小鎮地圖";
        this.intro.textContent = welcome
            ? "現在先照 Discord 頻道自動產生：每個頻道一間房，依分類分區。可以換成下面任一種，之後按上方「地圖」隨時能再換。"
            : "選一種換掉現在的地圖，在線的人會一起換。";
        this.closeButton.textContent = welcome ? "先用自動產生的" : "關閉";
        this.result.textContent = "";
        this.panel.hidden = false;
    }

    private build() {
        this.panel.setAttribute("aria-label", "小鎮地圖");
        this.closeButton.addEventListener("click", () => {
            if (this.welcome) void this.post({ reset: true }); // 記下選過了，之後不再跳
            this.panel.hidden = true;
        });
        const design = this.button("請 Claude 設計", () => void this.design());
        const auto = this.button("用這個", () => void this.post({ reset: true }));
        const upload = this.button("匯入", () => void this.importFiles());
        this.busy = [design, auto, upload];

        this.panel.append(
            this.title,
            this.intro,
            this.section("照頻道自動產生", "每個頻道一間房，依 Discord 的分類分區；頻道變動時自動更新。", auto),
            this.section(
                "請 Claude 設計",
                "寫一段想要的樣子，Claude 依頻道清單決定怎麼分區、房間大小和地板。頻道名稱和這段描述會送到 Anthropic 的 Claude 處理。",
                this.prompt,
                design,
            ),
            this.section("匯入地圖檔", "Tiled 或 tilemap.dev 匯出的 JSON，和它用到的圖塊圖片一起選。", this.files, upload),
            this.section("匯出目前的地圖", "下載 Tiled 格式的地圖和圖塊圖片，用 Tiled 打開修改後，再從上面匯入。", this.button("下載", () => void this.download())),
            this.result,
            this.closeButton,
        );
        document.body.append(this.panel);
    }

    private section(title: string, hint: string, ...controls: HTMLElement[]) {
        const box = el("div", { className: "map-option" });
        box.append(el("h3", { textContent: title }), el("p", { textContent: hint }), ...controls);
        return box;
    }

    private async design() {
        const prompt = this.prompt.value.trim();
        if (!prompt) return this.say(false, "請先寫一段想要的小鎮樣子");
        this.say(true, "Claude 設計中，大約要 10～60 秒…");
        await this.post({ prompt });
    }

    /** 讀選好的檔案：.json/.tmj 是地圖，其他是圖塊圖片（用檔名對應地圖裡的圖塊集）。 */
    private async importFiles() {
        const files = Array.from(this.files.files ?? []);
        const mapFile = files.find((f) => /\.(json|tmj)$/i.test(f.name));
        if (!mapFile) return this.say(false, "要選一個 Tiled JSON 地圖檔（.json 或 .tmj）");
        let map: unknown;
        try {
            map = JSON.parse(await mapFile.text());
        } catch {
            return this.say(false, "地圖檔不是 JSON，請在 tilemap.dev 或 Tiled 匯出成 JSON");
        }
        const images: Record<string, string> = {};
        for (const file of files.filter((f) => f !== mapFile)) images[file.name] = await this.readDataUrl(file);
        await this.post({ map, images });
    }

    private async post(body: object) {
        this.busy.forEach((b) => (b.disabled = true));
        try {
            const { data } = await this.http.post("/town_map", { body });
            this.say(data.ok, data.message);
            if (data.ok) this.welcome = false;
        } catch (e) {
            this.say(false, (e as { data?: { message?: string } }).data?.message ?? "暫時沒辦法換地圖，請稍後再試");
        } finally {
            this.busy.forEach((b) => (b.disabled = false));
        }
    }

    /**
     * 匯出：地圖 JSON 和圖塊圖片各下載一個檔。自動產生的小鎮把內建的 tiles.svg 畫成 PNG（Tiled 和匯入都要 PNG）。
     * ponytail: 在 Discord 裡下載可能被擋（查不到 Activity 的 iframe 有沒有開放下載）；擋住時用瀏覽器打開小鎮網址再匯出。
     */
    private async download() {
        if (!this.room.state.map) return;
        const { map, images } = exportMap(JSON.parse(this.room.state.map) as TownMapState);
        this.save("kisskiss-town.tmj", new Blob([JSON.stringify(map)], { type: "application/json" }));
        for (const [name, dataUrl] of Object.entries(images)) this.save(name, dataUrlToBlob(dataUrl || (await this.tilesPng())));
        this.say(true, "下載好了：kisskiss-town.tmj 和圖塊圖片。沒看到檔案的話，用瀏覽器打開小鎮再匯出一次");
    }

    private save(name: string, blob: Blob) {
        const url = URL.createObjectURL(blob);
        el("a", { href: url, download: name }).click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }

    /** 內建圖塊（maps/tiles.svg，一排 4 格）畫成 PNG。路徑不加開頭的 /，在 Discord 裡才會套用 .proxy/ 前綴。 */
    private tilesPng() {
        return new Promise<string>((resolve, reject) => {
            const image = new Image();
            image.onload = () => {
                const canvas = el("canvas", { width: 64, height: 16 });
                canvas.getContext("2d")!.drawImage(image, 0, 0, 64, 16);
                resolve(canvas.toDataURL("image/png"));
            };
            image.onerror = () => reject(new Error("讀不到圖塊圖片"));
            image.src = "maps/tiles.svg";
        });
    }

    private readDataUrl(file: File) {
        return new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
        });
    }

    private say(ok: boolean, message: string) {
        this.result.textContent = message;
        this.result.classList.toggle("error", !ok);
    }

    private button(text: string, onClick: () => void) {
        const b = el("button", { type: "button", textContent: text });
        b.addEventListener("click", onClick);
        return b;
    }
}

/** data URL 轉成檔案內容（不用 fetch：Discord 的內容安全政策可能不准 fetch data: 網址）。 */
function dataUrlToBlob(dataUrl: string) {
    const [head, base64] = dataUrl.split(",");
    const type = /^data:([^;]+)/.exec(head)?.[1] ?? "application/octet-stream";
    return new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type });
}
