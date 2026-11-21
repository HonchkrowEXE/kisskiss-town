import { Callbacks, type Client, type Room } from "@colyseus/sdk";
import type { TownState } from "../../../server/src/rooms/schema/TownState.js";
import type { TownMapState } from "../../../server/src/town/layoutTown.js";
import { GAME_ICONS, GAME_KINDS, GAME_TITLES, type GameKind } from "../../../server/src/town/tables.js";

/**
 * 只有管理員看得到的設定（伺服器確認是管理員才會送 admin，每次改也會再確認）：
 * - 搧巴掌通知發在哪個文字頻道
 * - 遊戲桌：在自己站的地方放一張、把某張搬到自己站的地方、移除
 * - 地圖：匯入 tilemap.dev 或 Tiled 的地圖（覆蓋自動長出來的小鎮）、改回自動
 */
export class AdminControls {
    private room: Room<any, TownState>;
    /** 放控制項的那一列（籌碼列）。 */
    private bar: HTMLElement;
    private notifySelect = document.createElement("select");
    private gameSelect = document.createElement("select");
    private tableSelect = document.createElement("select");
    private result = Object.assign(document.createElement("span"), { className: "chip-result", role: "status" });
    private clearTimer?: ReturnType<typeof setTimeout>;

    private http: Client["http"];
    private mapFiles = Object.assign(document.createElement("input"), {
        type: "file",
        multiple: true,
        accept: ".json,.tmj,image/png,image/jpeg,image/gif,image/webp",
        title: "選 Tiled JSON 和它用到的圖塊圖片",
    });

    /** http：上傳地圖用（在 Discord 裡會自動走 URL Mapping 代理，並帶上登入的 token）。 */
    constructor(room: Room<any, TownState>, bar: HTMLElement, http: Client["http"]) {
        this.room = room;
        this.bar = bar;
        this.http = http;
        room.onMessage("admin", ({ notifyChannel }: { notifyChannel: string }) => this.show(notifyChannel));
        room.onMessage("adminResult", (r: { ok: boolean; message: string }) => this.showResult(r));
    }

    private show(notifyChannel: string) {
        const notify = Object.assign(document.createElement("label"), { className: "admin-notify", textContent: "巴掌通知發在 " });
        notify.append(this.notifySelect);
        this.notifySelect.addEventListener("change", () => this.room.send("setNotifyChannel", this.notifySelect.value));

        this.gameSelect.replaceChildren(...GAME_KINDS.map((g) => new Option(`${GAME_ICONS[g]} ${GAME_TITLES[g]}`, g)));
        const tables = Object.assign(document.createElement("span"), { className: "admin-tables", textContent: "遊戲桌 " });
        tables.append(
            this.gameSelect,
            this.button("放在我這裡", () => this.room.send("placeTable", { game: this.gameSelect.value })),
            this.tableSelect,
            this.button("搬到我這裡", () => this.room.send("moveTable", { tableId: this.tableSelect.value })),
            this.button("移除", () => this.room.send("removeTable", { tableId: this.tableSelect.value })),
        );
        // 自訂地圖：一次選 tilemap.dev 或 Tiled 匯出的 JSON 和圖塊圖片
        const mapControls = Object.assign(document.createElement("span"), { className: "admin-tables", textContent: "地圖 " });
        mapControls.append(
            this.mapFiles,
            this.button("匯入", () => void this.importMap()),
            this.button("改回自動", () => void this.postMap({ reset: true })),
        );
        this.bar.append(notify, tables, mapControls, this.result);

        const callbacks = Callbacks.get(this.room);
        // 通知頻道的選項是小鎮上的文字房；頻道變動時跟著更新
        callbacks.listen("map", (json) => json && this.fillNotifyOptions(JSON.parse(json), this.notifySelect.value || notifyChannel), true);
        // 桌子清單跟著擺放、移除更新
        callbacks.onAdd("tables", () => queueMicrotask(() => this.fillTableOptions()));
        callbacks.onRemove("tables", () => queueMicrotask(() => this.fillTableOptions()));
    }

    private fillNotifyOptions(map: TownMapState, selected: string) {
        const options = [new Option("系統訊息頻道", "")];
        for (const r of map.rooms) if (r.kind === "text") options.push(new Option(`# ${r.name}`, r.id));
        this.notifySelect.replaceChildren(...options);
        this.notifySelect.value = options.some((o) => o.value === selected) ? selected : "";
    }

    private fillTableOptions() {
        const selected = this.tableSelect.value;
        const options: HTMLOptionElement[] = [];
        this.room.state.tables.forEach((t, id) => {
            const game = t.game as GameKind;
            options.push(new Option(`${GAME_ICONS[game]} ${GAME_TITLES[game]}（${Math.round(t.x / 16)}, ${Math.round(t.y / 16)}）`, id));
        });
        this.tableSelect.replaceChildren(...options);
        if (options.some((o) => o.value === selected)) this.tableSelect.value = selected;
    }

    /** 讀選好的檔案：.json/.tmj 是地圖，其他是圖塊圖片（用檔名對應地圖裡的圖塊集）。 */
    private async importMap() {
        const files = Array.from(this.mapFiles.files ?? []);
        const mapFile = files.find((f) => /\.(json|tmj)$/i.test(f.name));
        if (!mapFile) return this.showResult({ ok: false, message: "要選一個 Tiled JSON 地圖檔（.json 或 .tmj）" });
        let map: unknown;
        try {
            map = JSON.parse(await mapFile.text());
        } catch {
            return this.showResult({ ok: false, message: "地圖檔不是 JSON，請在 tilemap.dev 或 Tiled 匯出成 JSON" });
        }
        const images: Record<string, string> = {};
        for (const file of files.filter((f) => f !== mapFile)) images[file.name] = await this.readDataUrl(file);
        await this.postMap({ map, images });
    }

    private async postMap(body: object) {
        try {
            const { data } = await this.http.post("/town_map", { body });
            this.showResult(data);
        } catch (e) {
            this.showResult({ ok: false, message: (e as { data?: { message?: string } }).data?.message ?? "暫時沒辦法換地圖，請稍後再試" });
        }
    }

    private readDataUrl(file: File) {
        return new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
        });
    }

    private button(text: string, onClick: () => void) {
        const b = Object.assign(document.createElement("button"), { type: "button", textContent: text });
        b.addEventListener("click", onClick);
        return b;
    }

    private showResult({ ok, message }: { ok: boolean; message: string }) {
        this.result.textContent = message;
        this.result.classList.toggle("error", !ok);
        clearTimeout(this.clearTimer);
        this.clearTimer = setTimeout(() => (this.result.textContent = ""), 3000);
    }
}
