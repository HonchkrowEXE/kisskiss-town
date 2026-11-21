import Phaser from "phaser";
import { Callbacks, type Room } from "@colyseus/sdk";
import type { TownState, Direction, VoiceFigure } from "../../server/src/rooms/schema/TownState.js";
import type { TownMapState } from "../../server/src/town/layoutTown.js";
import { createWalkable, SPEED, type Walkable } from "../../server/src/town/walkable.js";

/** hero.svg 裡四個方向的格子順序。 */
const FRAME: Record<Direction, number> = { down: 0, left: 1, right: 2, up: 3 };

/** 走動時多久送一次位置給伺服器（毫秒）。 */
const SEND_INTERVAL = 50;

/** 名字標籤在腳底上方幾個像素。 */
const LABEL_OFFSET = 13;

/** 一幀最多走多久（毫秒）：分頁切回前景時 delta 會很大，一步跨太遠可能穿牆。 */
const MAX_STEP_MS = 50;

/** 房間名稱最多顯示幾個字，太長的截斷。 */
const ROOM_NAME_MAX = 10;

/** 圖層的前後順序：地圖在最下面，房間名稱、角色、名字依序往上。 */
const DEPTH = { map: 0, roomName: 5, character: 10, name: 11 };

type CharacterView = { sprite: Phaser.GameObjects.Sprite; label: Phaser.GameObjects.Text };

/** 名字後面的動態（名詞表）：靜音、拒聽、直播中。不在語音裡就是空字串。 */
function dynamicsText(figure: VoiceFigure | undefined) {
    if (!figure) return "";
    return (figure.muted ? " 🔇" : "") + (figure.deafened ? " 🙉" : "") + (figure.streaming ? " 🔴" : "");
}

export class TownScene extends Phaser.Scene {
    private room: Room<any, TownState>;
    private walkable?: Walkable;
    private views = new Map<string, CharacterView>();
    /** 語音頻道裡、沒打開小鎮的人，key 是帳號 ID。 */
    private figures = new Map<string, CharacterView>();
    /** 房名標籤，key 是頻道 ID；直播時在原本的字後面加標示。 */
    private roomLabels = new Map<string, { label: Phaser.GameObjects.Text; text: string }>();
    private keys!: Record<"up" | "down" | "left" | "right" | "w" | "a" | "s" | "d", Phaser.Input.Keyboard.Key>;

    /** 目前畫在畫面上的地圖相關物件，地圖換掉時一起清掉。 */
    private mapObjects: Phaser.GameObjects.GameObject[] = [];
    private tilemap?: Phaser.Tilemaps.Tilemap;
    /** 伺服器要提示成員的話（例如還讀不到頻道）。用網頁元素顯示：放在 Phaser 裡會跟著鏡頭放大 3 倍，跑出畫面。 */
    private notice = Object.assign(document.body.appendChild(document.createElement("div")), { className: "map-notice", hidden: true });

    /** 自己的位置由前端先走、伺服器驗證；不合法時伺服器會傳 moveRejected 拉回來。 */
    private me = { x: 0, y: 0, dir: "down" as Direction };
    private lastSent = { x: 0, y: 0, dir: "down" as Direction, at: 0 };

    constructor(room: Room<any, TownState>) {
        super("town");
        this.room = room;
    }

    preload() {
        // 路徑不加開頭的 /，在 DC 裡才會套用 index.html 設的 .proxy/ 前綴
        this.load.svg("tiles", "maps/tiles.svg");
        this.load.spritesheet("hero", "sprites/hero.svg", { frameWidth: 16, frameHeight: 16 });
    }

    create() {
        // 畫面是 960×720，放大 3 倍等於看到地圖上 320×240 的範圍
        this.cameras.main.setZoom(3);

        const kb = this.input.keyboard!;
        const K = Phaser.Input.Keyboard.KeyCodes;
        this.keys = kb.addKeys({
            up: K.UP, down: K.DOWN, left: K.LEFT, right: K.RIGHT, w: K.W, a: K.A, s: K.S, d: K.D,
        }) as typeof this.keys;

        const callbacks = Callbacks.get(this.room);

        // 地圖由伺服器依頻道清單產生，頻道變動時整份換掉
        callbacks.listen("map", (json) => json && this.showMap(JSON.parse(json)), true);

        callbacks.onAdd("characters", (character, sessionId) => {
            const { x, y } = character.position;
            const sprite = this.add
                .sprite(x, y, "hero", FRAME[character.dir as Direction] ?? 0)
                .setOrigin(0.5, 0.75)
                .setDepth(DEPTH.character);
            const label = this.add
                .text(x, y - LABEL_OFFSET, character.name, { fontSize: "8px", color: "#fff", resolution: 3 })
                .setOrigin(0.5, 1)
                .setDepth(DEPTH.name);
            this.views.set(sessionId, { sprite, label });
            if (sessionId === this.room.sessionId) {
                this.me = { x, y, dir: character.dir as Direction };
                this.lastSent = { ...this.me, at: 0 };
                this.cameras.main.startFollow(sprite, true);
            }
        });

        callbacks.onRemove("characters", (_character, sessionId) => {
            const view = this.views.get(sessionId);
            view?.sprite.destroy();
            view?.label.destroy();
            this.views.delete(sessionId);
        });

        this.room.onMessage("moveRejected", (pos: { x: number; y: number; dir: Direction }) => {
            this.me.x = pos.x;
            this.me.y = pos.y;
            this.me.dir = pos.dir;
            this.lastSent = { ...this.me, at: this.time.now };
        });
    }

    /** 畫出伺服器給的地圖：圖塊、房間名稱，沒有 bot 時顯示提示。 */
    private showMap(state: TownMapState) {
        this.tilemap?.destroy();
        for (const object of this.mapObjects) object.destroy();
        this.mapObjects = [];

        const { map, rooms } = state;
        const data = map.layers[0].data!;
        const rows = Array.from({ length: map.height }, (_, y) => data.slice(y * map.width, (y + 1) * map.width));
        this.tilemap = this.make.tilemap({ data: rows, tileWidth: map.tilewidth, tileHeight: map.tileheight });
        // 最後一個參數 1：圖塊編號從 1 開始（跟 Tiled 一樣），0 代表空格
        const tiles = this.tilemap.addTilesetImage("tiles", "tiles", map.tilewidth, map.tileheight, 0, 0, 1)!;
        this.tilemap.createLayer(0, tiles)!.setDepth(DEPTH.map);
        this.cameras.main.setBounds(0, 0, map.width * map.tilewidth, map.height * map.tileheight);

        this.roomLabels.clear();
        for (const room of rooms) {
            const name = room.name.length > ROOM_NAME_MAX ? `${room.name.slice(0, ROOM_NAME_MAX)}…` : room.name;
            const icon = room.kind === "voice" ? "🔊" : "#";
            const text = `${icon} ${name}`;
            const label = this.add
                .text(room.rect.x + room.rect.width / 2, room.rect.y + 2, text, {
                    fontSize: "7px",
                    color: "#fff",
                    resolution: 3,
                    backgroundColor: "#00000080",
                    padding: { x: 2, y: 1 },
                })
                .setOrigin(0.5, 0)
                .setDepth(DEPTH.roomName);
            this.mapObjects.push(label);
            this.roomLabels.set(room.id, { label, text });
        }

        this.notice.textContent = state.notice ?? "";
        this.notice.hidden = !state.notice;

        // 跟伺服器用同一份地圖資料算碰撞
        this.walkable = createWalkable(map);
    }

    update(time: number, delta: number) {
        this.walkMe(time, delta);

        // 每個角色往伺服器上的位置滑過去；自己的角色直接用前端算的位置
        const voice = this.room.state.voice;
        this.room.state.characters?.forEach((character, sessionId) => {
            const view = this.views.get(sessionId);
            if (!view) return;
            const isMe = sessionId === this.room.sessionId;
            const target = isMe ? this.me : character.position;
            const t = isMe ? 1 : Math.min(1, delta / 100);
            const x = Phaser.Math.Linear(view.sprite.x, target.x, t);
            const y = Phaser.Math.Linear(view.sprite.y, target.y, t);
            view.sprite.setPosition(x, y).setFrame(FRAME[(isMe ? this.me.dir : character.dir) as Direction] ?? 0);
            view.label.setPosition(x, y - LABEL_OFFSET).setText(character.name + dynamicsText(voice?.get(character.userId)));
        });

        this.showVoiceFigures();
    }

    /**
     * 語音頻道裡、但沒打開小鎮的人：站在語音房裡。有打開小鎮的人已經用能走動的角色顯示，這裡跳過。
     * 有人直播的語音房，房名後面加上直播標示。
     */
    private showVoiceFigures() {
        const voice = this.room.state.voice;
        if (!voice) return;
        const inTown = new Set<string>();
        this.room.state.characters?.forEach((character) => inTown.add(character.userId));

        const streamingRooms = new Set<string>();
        voice.forEach((figure, userId) => {
            if (figure.streaming) streamingRooms.add(figure.channelId);
            let view = this.figures.get(userId);
            if (inTown.has(userId)) {
                view?.sprite.setVisible(false);
                view?.label.setVisible(false);
                return;
            }
            if (!view) {
                view = {
                    sprite: this.add.sprite(figure.x, figure.y, "hero", FRAME.down).setOrigin(0.5, 0.75).setDepth(DEPTH.character),
                    label: this.add
                        .text(figure.x, figure.y - LABEL_OFFSET, "", { fontSize: "6px", color: "#fff", resolution: 3 })
                        .setOrigin(0.5, 1)
                        .setDepth(DEPTH.name),
                };
                this.figures.set(userId, view);
            }
            view.sprite.setVisible(true).setPosition(figure.x, figure.y);
            view.label.setVisible(true).setPosition(figure.x, figure.y - LABEL_OFFSET).setText(figure.name + dynamicsText(figure));
        });

        for (const [userId, view] of this.figures) {
            if (voice.has(userId)) continue;
            view.sprite.destroy();
            view.label.destroy();
            this.figures.delete(userId);
        }

        for (const [roomId, { label, text }] of this.roomLabels) {
            label.setText(streamingRooms.has(roomId) ? `${text} 🔴直播中` : text);
        }
    }

    /** 依鍵盤移動自己，撞牆時沿著牆滑（x、y 分開判斷），再定時把位置送給伺服器。 */
    private walkMe(time: number, delta: number) {
        if (!this.walkable) return;
        // 地圖換掉後自己可能站在新牆裡：伺服器會把角色送回廣場，跟著伺服器的位置走
        const mine = this.room.state.characters?.get(this.room.sessionId);
        if (mine && !this.walkable.canStand(this.me.x, this.me.y)) {
            this.me.x = mine.position.x;
            this.me.y = mine.position.y;
            this.lastSent = { ...this.me, at: time };
        }
        const k = this.keys;
        const dx = Number(k.right.isDown || k.d.isDown) - Number(k.left.isDown || k.a.isDown);
        const dy = Number(k.down.isDown || k.s.isDown) - Number(k.up.isDown || k.w.isDown);

        if (dx || dy) {
            // 斜走時不要比直走快
            const step = (SPEED * Math.min(delta, MAX_STEP_MS)) / 1000 / Math.hypot(dx, dy);
            const nx = this.me.x + dx * step;
            const ny = this.me.y + dy * step;
            if (this.walkable.canStand(nx, this.me.y)) this.me.x = nx;
            if (this.walkable.canStand(this.me.x, ny)) this.me.y = ny;
            // 面向以水平優先：斜走時看左右
            this.me.dir = dx < 0 ? "left" : dx > 0 ? "right" : dy < 0 ? "up" : "down";
        }

        const moved = this.me.x !== this.lastSent.x || this.me.y !== this.lastSent.y || this.me.dir !== this.lastSent.dir;
        if (moved && time - this.lastSent.at >= SEND_INTERVAL) {
            this.room.send("move", { x: this.me.x, y: this.me.y, dir: this.me.dir });
            this.lastSent = { ...this.me, at: time };
        }
    }
}
