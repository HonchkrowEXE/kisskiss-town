import Phaser from "phaser";
import type { TownMapState } from "../../../server/src/town/layoutTown.js";
import { createWalkable, type Walkable } from "../../../server/src/town/walkable.js";
import { DEPTH } from "./look.js";

/** 房間名稱最多顯示幾個字，太長的截斷。 */
const ROOM_NAME_MAX = 10;

/** 小鎮的地圖：圖塊、房間名稱、遊戲桌，以及沒有 bot 之類的提示。頻道變動時整份重畫。 */
export class MapView {
    /** 目前地圖的碰撞判斷（跟伺服器用同一份地圖資料算）；還沒收到地圖時是 undefined。 */
    walkable?: Walkable;

    private tilemap?: Phaser.Tilemaps.Tilemap;
    /** 目前畫在畫面上的地圖相關物件，地圖換掉時一起清掉。 */
    private objects: Phaser.GameObjects.GameObject[] = [];
    /** 房名標籤，key 是頻道 ID；直播時在原本的字後面加標示。 */
    private roomLabels = new Map<string, { label: Phaser.GameObjects.Text; text: string }>();
    /** 伺服器要提示成員的話。用網頁元素顯示：放在 Phaser 裡會跟著鏡頭放大 3 倍，跑出畫面。 */
    private notice = Object.assign(document.body.appendChild(document.createElement("div")), { className: "map-notice", hidden: true });

    private scene: Phaser.Scene;

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
    }

    /** 畫出伺服器給的地圖。 */
    show(state: TownMapState) {
        this.clear();
        const { map, rooms } = state;
        const data = map.layers[0].data!;
        const rows = Array.from({ length: map.height }, (_, y) => data.slice(y * map.width, (y + 1) * map.width));
        this.tilemap = this.scene.make.tilemap({ data: rows, tileWidth: map.tilewidth, tileHeight: map.tileheight });
        // 最後一個參數 1：圖塊編號從 1 開始（跟 Tiled 一樣），0 代表空格
        const tiles = this.tilemap.addTilesetImage("tiles", "tiles", map.tilewidth, map.tileheight, 0, 0, 1)!;
        this.tilemap.createLayer(0, tiles)!.setDepth(DEPTH.map);
        this.scene.cameras.main.setBounds(0, 0, map.width * map.tilewidth, map.height * map.tileheight);

        for (const room of rooms) {
            const name = room.name.length > ROOM_NAME_MAX ? `${room.name.slice(0, ROOM_NAME_MAX)}…` : room.name;
            const text = `${room.kind === "voice" ? "🔊" : "#"} ${name}`;
            const label = this.scene.add
                .text(room.rect.x + room.rect.width / 2, room.rect.y + 2, text, {
                    fontSize: "7px",
                    color: "#fff",
                    resolution: 3,
                    backgroundColor: "#00000080",
                    padding: { x: 2, y: 1 },
                })
                .setOrigin(0.5, 0)
                .setDepth(DEPTH.roomName);
            this.objects.push(label);
            this.roomLabels.set(room.id, { label, text });
        }

        // 遊戲桌：畫一張桌子；座位就是成員入座時站的位置
        for (const table of state.tables) {
            const top = this.scene.add.rectangle(table.x, table.y, 24, 14, 0x6d4c2f).setStrokeStyle(1, 0x3e2a18).setDepth(DEPTH.roomName);
            const dice = this.scene.add.text(table.x, table.y, "🎲", { fontSize: "8px", resolution: 3 }).setOrigin(0.5).setDepth(DEPTH.roomName);
            this.objects.push(top, dice);
        }

        this.notice.textContent = state.notice ?? "";
        this.notice.hidden = !state.notice;
        this.walkable = createWalkable(map);
    }

    /** 有人直播的語音房，房名後面加上「直播中」。 */
    markStreaming(roomIds: Set<string>) {
        for (const [roomId, { label, text }] of this.roomLabels) {
            label.setText(roomIds.has(roomId) ? `${text} 🔴直播中` : text);
        }
    }

    private clear() {
        this.tilemap?.destroy();
        for (const object of this.objects) object.destroy();
        this.objects = [];
        this.roomLabels.clear();
    }
}
