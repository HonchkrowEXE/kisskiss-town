import "./style.css";
import Phaser from "phaser";
import { Client } from "@colyseus/sdk";
import { login } from "./login.js";
import { TownScene } from "./TownScene.js";
import { mountChipHud } from "./chipHud.js";
import { mountTablePanel } from "./tablePanel.js";
import { mountTouchControls } from "./touchControls.js";
import { mountTextPanel } from "./textPanel.js";

const app = document.querySelector<HTMLDivElement>("#app")!;
// 在 Discord 裡 SDK 會自己在網址前加 /.proxy/colyseus，所以只給網域
const colyseus = new Client(location.hostname.endsWith("discordsays.com") ? location.origin : "/colyseus");

try {
    const { guildId } = await login(colyseus);
    const room = await colyseus.joinOrCreate("town", { guildId });
    // 開發時從 devtools（或自動化測試）看得到房間狀態
    if (import.meta.env.DEV) (window as any).room = room;

    // 斷線時在畫面上方提示；SDK 會自己試著重連，重連失敗才會 onLeave
    const notice = document.createElement("div");
    notice.className = "notice";
    document.body.append(notice);
    /** 顯示提示；給空字串就藏起來。 */
    function show(text: string) {
        notice.textContent = text;
        notice.hidden = text === "";
    }
    show("");
    room.onDrop(() => show("連線中斷，重新連線中…"));
    room.onReconnect(() => show(""));
    room.onError((code, message) => show(`小鎮出錯了（${code}）：${message ?? ""}`));
    room.onLeave(() => show("和小鎮的連線中斷了，請關掉親親小鎮再打開"));

    mountChipHud(room);
    mountTablePanel(room);
    mountTextPanel(room);
    const stick = mountTouchControls(room);


    new Phaser.Game({
        parent: app,
        width: 960, // 地圖 320×240（20×15 格，每格 16px）放大 3 倍，文字才清楚
        height: 720,
        pixelArt: true, // 放大時不模糊，保持像素感
        backgroundColor: "#000",
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
        scene: new TownScene(room, stick),
    });
} catch (e) {
    console.error(e);
    app.textContent = `進不了小鎮：${e instanceof Error ? `${e.name} ${(e as any).code ?? ""} ${e.message}` : JSON.stringify(e)}`;
}
