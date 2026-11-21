import Phaser from "phaser";
import { Callbacks, type Room } from "@colyseus/sdk";
import type { TownState, Direction } from "../../server/src/rooms/schema/TownState.js";
import { createWalkable, SPEED, type Walkable } from "../../server/src/town/walkable.js";

/** hero.svg 裡四個方向的格子順序。 */
const FRAME: Record<Direction, number> = { down: 0, left: 1, right: 2, up: 3 };

/** 走動時多久送一次位置給伺服器（毫秒）。 */
const SEND_INTERVAL = 50;

/** 名字標籤在腳底上方幾個像素。 */
const LABEL_OFFSET = 13;

/** 一幀最多走多久（毫秒）：分頁切回前景時 delta 會很大，一步跨太遠可能穿牆。 */
const MAX_STEP_MS = 50;

type CharacterView = { sprite: Phaser.GameObjects.Sprite; label: Phaser.GameObjects.Text };

export class TownScene extends Phaser.Scene {
    private room: Room<any, TownState>;
    private walkable!: Walkable;
    private views = new Map<string, CharacterView>();
    private keys!: Record<"up" | "down" | "left" | "right" | "w" | "a" | "s" | "d", Phaser.Input.Keyboard.Key>;

    /** 自己的位置由前端先走、伺服器驗證；不合法時伺服器會傳 moveRejected 拉回來。 */
    private me = { x: 0, y: 0, dir: "down" as Direction };
    private lastSent = { x: 0, y: 0, dir: "down" as Direction, at: 0 };

    constructor(room: Room<any, TownState>) {
        super("town");
        this.room = room;
    }

    preload() {
        // 路徑不加開頭的 /，在 DC 裡才會套用 index.html 設的 .proxy/ 前綴
        this.load.tilemapTiledJSON("town", "maps/town.json");
        this.load.svg("tiles", "maps/tiles.svg");
        this.load.spritesheet("hero", "sprites/hero.svg", { frameWidth: 16, frameHeight: 16 });
    }

    create() {
        const map = this.make.tilemap({ key: "town" });
        // 第一個參數是 Tiled JSON 裡圖塊集的名字，第二個是 preload 時取的 key
        const tiles = map.addTilesetImage("tiles", "tiles")!;
        map.createLayer("ground", tiles);
        // 畫面是地圖的 3 倍大，鏡頭跟著放大 3 倍並對準地圖中央
        this.cameras.main.setZoom(3).centerOn(map.widthInPixels / 2, map.heightInPixels / 2);

        // 跟伺服器用同一份地圖資料算碰撞
        this.walkable = createWalkable(this.cache.tilemap.get("town").data);

        const kb = this.input.keyboard!;
        const K = Phaser.Input.Keyboard.KeyCodes;
        this.keys = kb.addKeys({
            up: K.UP, down: K.DOWN, left: K.LEFT, right: K.RIGHT, w: K.W, a: K.A, s: K.S, d: K.D,
        }) as typeof this.keys;

        const callbacks = Callbacks.get(this.room);

        callbacks.onAdd("characters", (character, sessionId) => {
            const { x, y } = character.position;
            const sprite = this.add.sprite(x, y, "hero", FRAME[character.dir as Direction] ?? 0).setOrigin(0.5, 0.75);
            const label = this.add
                .text(x, y - LABEL_OFFSET, character.name, { fontSize: "8px", color: "#fff", resolution: 3 })
                .setOrigin(0.5, 1);
            this.views.set(sessionId, { sprite, label });
            if (sessionId === this.room.sessionId) {
                this.me = { x, y, dir: character.dir as Direction };
                this.lastSent = { ...this.me, at: 0 };
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

    update(time: number, delta: number) {
        this.walkMe(time, delta);

        // 每個角色往伺服器上的位置滑過去；自己的角色直接用前端算的位置
        this.room.state.characters?.forEach((character, sessionId) => {
            const view = this.views.get(sessionId);
            if (!view) return;
            const isMe = sessionId === this.room.sessionId;
            const target = isMe ? this.me : character.position;
            const t = isMe ? 1 : Math.min(1, delta / 100);
            const x = Phaser.Math.Linear(view.sprite.x, target.x, t);
            const y = Phaser.Math.Linear(view.sprite.y, target.y, t);
            view.sprite.setPosition(x, y).setFrame(FRAME[(isMe ? this.me.dir : character.dir) as Direction] ?? 0);
            view.label.setPosition(x, y - LABEL_OFFSET);
        });
    }

    /** 依鍵盤移動自己，撞牆時沿著牆滑（x、y 分開判斷），再定時把位置送給伺服器。 */
    private walkMe(time: number, delta: number) {
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
