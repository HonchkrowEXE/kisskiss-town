import "./style.css";
import Phaser from "phaser";
import { Client } from "@colyseus/sdk";
import { login } from "./login.js";
import { TownScene } from "./TownScene.js";

const app = document.querySelector<HTMLDivElement>("#app")!;
// 在 Discord 裡 SDK 會自己在網址前加 /.proxy/colyseus，所以只給網域
const colyseus = new Client(location.hostname.endsWith("discordsays.com") ? location.origin : "/colyseus");

try {
    const { guildId } = await login(colyseus);
    const room = await colyseus.joinOrCreate("town", { guildId });

    new Phaser.Game({
        parent: app,
        width: 960, // 地圖 320×240（20×15 格，每格 16px）放大 3 倍，文字才清楚
        height: 720,
        pixelArt: true, // 放大時不模糊，保持像素感
        backgroundColor: "#000",
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
        scene: new TownScene(room),
    });
} catch (e) {
    console.error(e);
    app.textContent = `進不了小鎮：${e instanceof Error ? `${e.name} ${(e as any).code ?? ""} ${e.message}` : JSON.stringify(e)}`;
}
