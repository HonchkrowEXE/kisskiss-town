import type { Room } from "@colyseus/sdk";
import type { TownState } from "../../../server/src/rooms/schema/TownState.js";
import { OBJECT_KINDS, type ObjectKind } from "../../../server/src/town/objects.js";

/** 編輯器的工具：放某種家具，或橡皮擦。 */
export type EditorTool = ObjectKind | "remove";

/**
 * 家具編輯器（只有管理員看得到）：選一種家具或橡皮擦，然後點地圖的格子。
 * 伺服器每次放、移除都會再確認是不是管理員。家具種類來自 OBJECT_KINDS，加新家具這裡會自動多一個按鈕。
 */
export class FurnitureEditor {
    /** TownScene 每次點地圖時讀這個；null 表示編輯器關著。 */
    readonly state: { tool: EditorTool | null } = { tool: null };
    private panel = document.createElement("section");
    private room: Room<any, TownState>;

    constructor(room: Room<any, TownState>, bar: HTMLElement) {
        this.room = room;
        room.onMessage("admin", () => this.mount(bar));
    }

    private mount(bar: HTMLElement) {
        const toggle = Object.assign(document.createElement("button"), { type: "button", textContent: "編輯家具" });
        toggle.addEventListener("click", () => this.setOpen(this.panel.hidden === true));
        bar.append(toggle);

        this.panel.className = "furniture-editor";
        this.panel.hidden = true;
        this.panel.setAttribute("aria-label", "家具編輯器");
        const tools = document.createElement("div");
        tools.className = "editor-tools";
        const choices: [EditorTool, string][] = [
            ...Object.entries(OBJECT_KINDS).map(([kind, def]) => [kind as ObjectKind, def.name] as [EditorTool, string]),
            ["remove", "🧽 移除"],
        ];
        for (const [tool, label] of choices) {
            const button = Object.assign(document.createElement("button"), { type: "button", textContent: label });
            button.dataset.tool = tool;
            button.setAttribute("aria-pressed", "false");
            button.addEventListener("click", () => this.select(tool));
            tools.append(button);
        }
        const reset = Object.assign(document.createElement("button"), { type: "button", textContent: "還原預設家具" });
        reset.addEventListener("click", () => this.room.send("resetObjects"));
        const close = Object.assign(document.createElement("button"), { type: "button", textContent: "完成" });
        close.addEventListener("click", () => this.setOpen(false));
        this.panel.append(
            Object.assign(document.createElement("h2"), { textContent: "家具編輯器" }),
            Object.assign(document.createElement("p"), { textContent: "選一種家具，再點地圖上的格子放下去；選「移除」再點家具就拿掉。" }),
            tools,
            reset,
            close,
        );
        document.body.append(this.panel);
        this.select("chair");
    }

    private setOpen(open: boolean) {
        this.panel.hidden = !open;
        this.state.tool = open ? (this.panel.querySelector<HTMLButtonElement>("[aria-pressed=true]")?.dataset.tool as EditorTool) ?? "chair" : null;
    }

    private select(tool: EditorTool) {
        if (!this.panel.hidden) this.state.tool = tool;
        for (const button of Array.from(this.panel.querySelectorAll<HTMLButtonElement>("[data-tool]"))) {
            button.setAttribute("aria-pressed", String(button.dataset.tool === tool));
        }
    }
}
