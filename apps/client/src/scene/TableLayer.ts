import Phaser from "phaser";
import { Callbacks, type Room } from "@colyseus/sdk";
import type { TownState } from "../../../server/src/rooms/schema/TownState.js";
import { GAME_ICONS, type GameKind } from "../../../server/src/town/tables.js";
import { DEPTH } from "./look.js";

type TableView = { top: Phaser.GameObjects.Rectangle; icon: Phaser.GameObjects.Text };

/** 地圖上的遊戲桌：一張桌子和遊戲的圖示。管理員擺放、搬移、移除時跟著更新。 */
export class TableLayer {
    private tables = new Map<string, TableView>();

    constructor(scene: Phaser.Scene, room: Room<any, TownState>) {
        const callbacks = Callbacks.get(room);
        callbacks.onAdd("tables", (table, id) => {
            const view = {
                top: scene.add.rectangle(table.x, table.y, 24, 14, 0x6d4c2f).setStrokeStyle(1, 0x3e2a18).setDepth(DEPTH.roomName),
                icon: scene.add.text(table.x, table.y, GAME_ICONS[table.game as GameKind] ?? "🎲", { fontSize: "8px", resolution: 3 }).setOrigin(0.5).setDepth(DEPTH.roomName),
            };
            this.tables.set(id, view);
            // 管理員搬桌子時跟著移動
            callbacks.listen(table, "x", (x) => [view.top, view.icon].forEach((o) => o.setX(x)));
            callbacks.listen(table, "y", (y) => [view.top, view.icon].forEach((o) => o.setY(y)));
        });
        callbacks.onRemove("tables", (_table, id) => {
            const view = this.tables.get(id);
            view?.top.destroy();
            view?.icon.destroy();
            this.tables.delete(id);
        });
    }
}
