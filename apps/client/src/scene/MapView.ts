import Phaser from "phaser";
import type { TownMapState } from "../../../server/src/town/layoutTown.js";
import { createWalkable, isCollisionLayer, type Walkable } from "../../../server/src/town/walkable.js";
import { blockedTiles, type TownObject } from "../../../server/src/town/objects.js";
import { DEPTH } from "./look.js";

/** 房間名稱最多顯示幾個字，太長的截斷。 */
const ROOM_NAME_MAX = 10;

/** 小鎮的地圖：圖塊、房間名稱、分區名稱，以及沒有 bot 之類的提示。頻道變動或管理員換地圖時整份重畫。遊戲桌在 TableLayer。 */
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

    /** 第幾次收到地圖；圖片載入是非同步的，載完時地圖已經又換了就不畫。 */
    private version = 0;
    /** 圖片（data URL）→ 已載入的材質名稱，同一張圖不重複載入。 */
    private textures = new Map<string, string>();

    /** 畫出伺服器給的地圖：自動長出來的小鎮用內建圖塊，匯入的自訂地圖用它自己的圖塊圖片。 */
    show(state: TownMapState) {
        const version = ++this.version;
        this.clear();
        const { map, rooms } = state;
        if (state.images) void this.drawCustom(state, version);
        else this.drawAuto(state);
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

        // 分區名稱（Discord 的分類，或 Claude 設計的分區）
        for (const { text, x, y } of state.labels ?? []) {
            const label = this.scene.add
                .text(x, y, text, { fontSize: "8px", color: "#fff", resolution: 3, backgroundColor: "#4a2e1ccc", padding: { x: 3, y: 1 } })
                .setDepth(DEPTH.roomName);
            this.objects.push(label);
        }

        this.notice.textContent = state.notice ?? "";
        this.notice.hidden = !state.notice;
        this.current = state;
        this.updateWalkable();
    }

    /** 目前的地圖（還沒收到是 undefined）。 */
    current?: TownMapState;
    /** 擋路的家具，碰撞判斷要算進去。 */
    private furniture: TownObject[] = [];

    /** 家具變了：重算碰撞（跟伺服器一樣，擋路的家具算牆）。 */
    setFurniture(objects: TownObject[]) {
        this.furniture = objects;
        this.updateWalkable();
    }

    private updateWalkable() {
        if (!this.current) return;
        const { map } = this.current;
        this.walkable = createWalkable(map, blockedTiles(this.furniture, map.width));
    }

    /** 自動長出來的小鎮：一層圖塊，用內建的 tiles.svg。 */
    private drawAuto({ map }: TownMapState) {
        const data = map.layers[0].data!;
        const rows = Array.from({ length: map.height }, (_, y) => data.slice(y * map.width, (y + 1) * map.width));
        this.tilemap = this.scene.make.tilemap({ data: rows, tileWidth: map.tilewidth, tileHeight: map.tileheight });
        // 最後一個參數 1：圖塊編號從 1 開始（跟 Tiled 一樣），0 代表空格
        const tiles = this.tilemap.addTilesetImage("tiles", "tiles", map.tilewidth, map.tileheight, 0, 0, 1)!;
        this.tilemap.createLayer(0, tiles)!.setDepth(DEPTH.map);
    }

    /** 匯入的自訂地圖：先載入圖塊圖片，再交給 Phaser 讀 Tiled JSON；碰撞用的圖層不畫。 */
    private async drawCustom(state: TownMapState, version: number) {
        const { map, images } = state;
        const keys = await Promise.all(map.tilesets.map((ts) => this.loadImage(images![ts.image!])));
        if (version !== this.version) return;
        const cacheKey = `custom-map-${version}`;
        this.scene.cache.tilemap.add(cacheKey, { format: Phaser.Tilemaps.Formats.TILED_JSON, data: map });
        const tilemap = this.scene.make.tilemap({ key: cacheKey });
        this.tilemap = tilemap;
        const tilesets = map.tilesets.map((ts, i) => tilemap.addTilesetImage(ts.name!, keys[i])!).filter(Boolean);
        for (const layer of map.layers) {
            if (layer.type !== "tilelayer" || layer.visible === false || isCollisionLayer(layer)) continue;
            tilemap.createLayer(layer.name!, tilesets)?.setDepth(DEPTH.map);
        }
    }

    /** 把 data URL 載入成材質，回傳材質名稱。 */
    private loadImage(dataUrl: string) {
        const known = this.textures.get(dataUrl);
        if (known) return Promise.resolve(known);
        const key = `map-image-${this.textures.size}`;
        this.textures.set(dataUrl, key);
        return new Promise<string>((resolve) => {
            this.scene.textures.once(`addtexture-${key}`, () => resolve(key));
            this.scene.textures.addBase64(key, dataUrl);
        });
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
