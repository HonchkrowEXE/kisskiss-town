import "./style.css";
import Phaser from "phaser";
import { Client } from "@colyseus/sdk";
import { login } from "./login.js";
import { TownScene } from "./scene/TownScene.js";
import { AdminControls } from "./ui/AdminControls.js";
import { ChipHud } from "./ui/ChipHud.js";
import { ConnectionNotice } from "./ui/ConnectionNotice.js";
import { TablePanel } from "./ui/TablePanel.js";
import { TextPanel } from "./ui/TextPanel.js";
import { Toast } from "./ui/Toast.js";
import { TouchControls } from "./ui/TouchControls.js";
import { WardrobePanel } from "./ui/WardrobePanel.js";
import { FurnitureEditor } from "./ui/FurnitureEditor.js";
import { FurniturePanel } from "./ui/FurniturePanel.js";

const app = document.querySelector<HTMLDivElement>("#app")!;
// 在 Discord 裡 SDK 會自己在網址前加 /.proxy/colyseus，所以只給網域
const colyseus = new Client(location.hostname.endsWith("discordsays.com") ? location.origin : "/colyseus");

try {
    const { guildId } = await login(colyseus);
    const room = await colyseus.joinOrCreate("town", { guildId });
    // 開發時從 devtools（或自動化測試）看得到房間狀態
    if (import.meta.env.DEV) (window as any).room = room;

    // 浮在地圖上面的網頁元素（不放進 Phaser：放進去會跟著鏡頭放大 3 倍）
    new ConnectionNotice(room);
    new Toast(room);
    const hud = new ChipHud(room);
    new WardrobePanel(room, hud.element, colyseus.http);
    new AdminControls(room, hud.element, colyseus.http);
    const editor = new FurnitureEditor(room, hud.element);
    new FurniturePanel(room);
    new TablePanel(room);
    new TextPanel(room);
    const touch = new TouchControls(room);

    new Phaser.Game({
        parent: app,
        pixelArt: true, // 放大時不模糊，保持像素感
        backgroundColor: "#000",
        // 畫布填滿視窗、跟著視窗改大小；放大倍率由 TownScene 依畫面大小決定
        scale: { mode: Phaser.Scale.RESIZE, width: "100%", height: "100%" },
        scene: new TownScene(room, touch.stick, editor.state),
    });
} catch (e) {
    console.error(e);
    app.textContent = `進不了小鎮：${e instanceof Error ? `${e.name} ${(e as any).code ?? ""} ${e.message}` : JSON.stringify(e)}`;
}
