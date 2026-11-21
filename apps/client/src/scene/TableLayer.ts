import Phaser from "phaser";
import { Callbacks, type Room } from "@colyseus/sdk";
import type { TownState } from "../../../server/src/rooms/schema/TownState.js";
import { GAME_ICONS, type GameKind } from "../../../server/src/town/tables.js";
import { DEPTH } from "./look.js";
import { outline, paint, shade } from "./pixelArt.js";

const FELT = "#3f8f5a";
const RIM = "#7a4a2a";

type TableView = { top: Phaser.GameObjects.Image; shadow: Phaser.GameObjects.Ellipse; icon: Phaser.GameObjects.Text };

/** 遊戲桌的圖：木框、綠色絨布檯面（跟家具同一套明暗與外框）。 */
function tableTexture(scene: Phaser.Scene) {
    const key = "game-table";
    if (scene.textures.exists(key)) return key;
    const texture = scene.textures.createCanvas(key, 28, 18)!;
    const ctx = texture.getContext();
    paint(ctx, [
        [3, 13, 2, 4, shade(RIM, -0.3)], // 桌腳
        [23, 13, 2, 4, shade(RIM, -0.3)],
        [1, 1, 26, 12, RIM], // 木框
        [1, 1, 26, 1, shade(RIM, 0.2)],
        [1, 12, 26, 2, shade(RIM, -0.3)], // 桌子正面
        [3, 3, 22, 8, FELT], // 絨布
        [3, 3, 22, 1, shade(FELT, 0.18)],
        [24, 4, 1, 7, shade(FELT, -0.2)],
    ]);
    outline(ctx, 0, 0, 28, 18);
    texture.refresh();
    return key;
}

/** 地圖上的遊戲桌：一張桌子和遊戲的圖示。管理員擺放、搬移、移除時跟著更新。 */
export class TableLayer {
    private tables = new Map<string, TableView>();

    constructor(scene: Phaser.Scene, room: Room<any, TownState>) {
        const callbacks = Callbacks.get(room);
        callbacks.onAdd("tables", (table, id) => {
            const view: TableView = {
                shadow: scene.add.ellipse(table.x, table.y + 8, 26, 4, 0x000000, 0.22).setDepth(DEPTH.object - 0.5),
                top: scene.add.image(table.x, table.y, tableTexture(scene)).setDepth(DEPTH.roomName),
                icon: scene.add.text(table.x, table.y - 2, GAME_ICONS[table.game as GameKind] ?? "🎲", { fontSize: "8px", resolution: 3 }).setOrigin(0.5).setDepth(DEPTH.roomName),
            };
            this.tables.set(id, view);
            // 管理員搬桌子時跟著移動
            callbacks.listen(table, "x", (x) => [view.top, view.icon, view.shadow].forEach((o) => o.setX(x)));
            callbacks.listen(table, "y", (y) => {
                view.top.setY(y);
                view.icon.setY(y - 2);
                view.shadow.setY(y + 8);
            });
        });
        callbacks.onRemove("tables", (_table, id) => {
            const view = this.tables.get(id);
            view?.top.destroy();
            view?.icon.destroy();
            view?.shadow.destroy();
            this.tables.delete(id);
        });
    }
}
