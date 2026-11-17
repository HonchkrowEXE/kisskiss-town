import Phaser from "phaser";
import { Callbacks, type Room } from "@colyseus/sdk";
import type { MyRoomState } from "../../server/src/rooms/schema/MyRoomState.js";

export class TownScene extends Phaser.Scene {
    private room: Room<any, MyRoomState>;

    constructor(room: Room<any, MyRoomState>) {
        super("town");
        this.room = room;
    }

    preload() {
        // 路徑不加開頭的 /，在 DC 裡才會套用 index.html 設的 .proxy/ 前綴
        this.load.tilemapTiledJSON("town", "maps/town.json");
        this.load.svg("tiles", "maps/tiles.svg");
    }

    create() {
        const map = this.make.tilemap({ key: "town" });
        // 第一個參數是 Tiled JSON 裡圖塊集的名字，第二個是 preload 時取的 key
        const tiles = map.addTilesetImage("tiles", "tiles")!;
        map.createLayer("ground", tiles);
        // 畫面是地圖的 3 倍大，鏡頭跟著放大 3 倍並對準地圖中央
        this.cameras.main.setZoom(3).centerOn(map.widthInPixels / 2, map.heightInPixels / 2);

        // 每位成員一個名字標籤，key 是連線的 sessionId
        const labels = new Map<string, Phaser.GameObjects.Text>();
        const callbacks = Callbacks.get(this.room);

        callbacks.onAdd("players", (player, sessionId) => {
            const label = this.add
                .text(player.position.x, player.position.y, player.name, { fontSize: "8px", color: "#fff", resolution: 3 })
                .setOrigin(0.5);
            labels.set(sessionId, label);
        });

        callbacks.onRemove("players", (_player, sessionId) => {
            labels.get(sessionId)?.destroy();
            labels.delete(sessionId);
        });
    }
}