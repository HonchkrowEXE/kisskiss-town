import Phaser from "phaser";
import type { Room } from "@colyseus/sdk";
import type { Direction, TownState } from "../../../server/src/rooms/schema/TownState.js";
import { SPEED, type Walkable } from "../../../server/src/town/walkable.js";

/** 走動時多久送一次位置給伺服器（毫秒）。 */
const SEND_INTERVAL = 50;

/** 一幀最多走多久（毫秒）：分頁切回前景時 delta 會很大，一步跨太遠可能穿牆。 */
const MAX_STEP_MS = 50;

/** 正在打字（焦點在文字輸入框）時，鍵盤不能拿來走路或按快捷鍵。 */
export const isTyping = () => {
    const el = document.activeElement;
    return el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && el.type === "text");
};

type Position = { x: number; y: number; dir: Direction };

/**
 * 操作自己的角色：鍵盤（方向鍵、WASD）或手機搖桿走路，F 搧巴掌、E 入座／起身。
 * 位置由前端先走、伺服器驗證；不合法時伺服器傳 moveRejected 拉回來。
 */
export class PlayerController {
    /** 自己現在的位置（前端算的）。 */
    readonly me: Position = { x: 0, y: 0, dir: "down" };
    private lastSent = { x: 0, y: 0, dir: "down" as Direction, at: 0 };
    private keys: Record<"up" | "down" | "left" | "right" | "w" | "a" | "s" | "d" | "slap" | "sit", Phaser.Input.Keyboard.Key>;

    private scene: Phaser.Scene;
    private room: Room<any, TownState>;
    /** 手機搖桿的方向（長度 0～1）；不是觸控螢幕時永遠是 0。 */
    private stick: { dx: number; dy: number };

    constructor(scene: Phaser.Scene, room: Room<any, TownState>, stick: { dx: number; dy: number }) {
        this.scene = scene;
        this.room = room;
        this.stick = stick;
        const K = Phaser.Input.Keyboard.KeyCodes;
        this.keys = scene.input.keyboard!.addKeys({
            up: K.UP, down: K.DOWN, left: K.LEFT, right: K.RIGHT, w: K.W, a: K.A, s: K.S, d: K.D, slap: K.F, sit: K.E,
        }, false) as typeof this.keys; // false：不攔下按鍵，文字房的輸入框才打得出 w、a、s、d、e、f

        // 搧旁邊的人；搧不搧得到、對方退到哪都由伺服器決定
        this.onKey(this.keys.slap, () => room.send("slap"));
        // 在遊戲桌旁按 E 入座，坐著時再按一次起身
        this.onKey(this.keys.sit, () => room.send(this.mine()?.seatedAt ? "stand" : "sit"));

        // 伺服器不接受這一步，或自己被搧了：跟著伺服器給的位置走
        room.onMessage("moveRejected", (pos: Position) => this.jumpTo(pos));
        room.onMessage("slapped", (pos: Position) => this.jumpTo(pos));
    }

    /** 從伺服器上的角色開始（剛進小鎮時）。 */
    startAt(pos: Position) {
        Object.assign(this.me, pos);
        this.lastSent = { ...pos, at: 0 };
    }

    /** 每一幀：依鍵盤或搖桿移動，撞牆時沿著牆滑（x、y 分開判斷），再定時把位置送給伺服器。 */
    update(time: number, delta: number, walkable: Walkable | undefined) {
        if (!walkable) return;
        const mine = this.mine();
        // 坐在遊戲桌時不能走；地圖換掉後站在新牆裡時伺服器會送回廣場。兩種都跟著伺服器的位置
        if (mine && (mine.seatedAt || !walkable.canStand(this.me.x, this.me.y))) {
            this.me.x = mine.position.x;
            this.me.y = mine.position.y;
            this.lastSent = { ...this.me, at: time };
            if (mine.seatedAt) return;
        }

        const [dx, dy] = this.direction();
        if (dx || dy) {
            const step = (SPEED * Math.min(delta, MAX_STEP_MS)) / 1000;
            const nx = this.me.x + dx * step;
            const ny = this.me.y + dy * step;
            if (walkable.canStand(nx, this.me.y)) this.me.x = nx;
            if (walkable.canStand(this.me.x, ny)) this.me.y = ny;
            // 面向看哪個方向推得多；一樣多（鍵盤斜走）時看左右
            this.me.dir = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? "left" : "right") : dy < 0 ? "up" : "down";
        }

        const moved = this.me.x !== this.lastSent.x || this.me.y !== this.lastSent.y || this.me.dir !== this.lastSent.dir;
        if (moved && time - this.lastSent.at >= SEND_INTERVAL) {
            this.room.send("move", { x: this.me.x, y: this.me.y, dir: this.me.dir });
            this.lastSent = { ...this.me, at: time };
        }
    }

    /** 想走的方向（鍵盤加搖桿），長度最多 1：斜走不會比直走快，搖桿輕推走得比較慢。打字時不看鍵盤。 */
    private direction(): [number, number] {
        const k = this.keys;
        const typing = isTyping();
        let dx = (typing ? 0 : Number(k.right.isDown || k.d.isDown) - Number(k.left.isDown || k.a.isDown)) + this.stick.dx;
        let dy = (typing ? 0 : Number(k.down.isDown || k.s.isDown) - Number(k.up.isDown || k.w.isDown)) + this.stick.dy;
        const length = Math.hypot(dx, dy);
        if (length > 1) [dx, dy] = [dx / length, dy / length];
        return [dx, dy];
    }

    private jumpTo(pos: Position) {
        Object.assign(this.me, { x: pos.x, y: pos.y, dir: pos.dir });
        this.lastSent = { ...this.me, at: this.scene.time.now };
    }

    private mine() {
        return this.room.state.characters?.get(this.room.sessionId);
    }

    /** 按下快捷鍵（按住不放不重複觸發，打字時不觸發）。 */
    private onKey(key: Phaser.Input.Keyboard.Key, action: () => void) {
        key.on("down", (_key: Phaser.Input.Keyboard.Key, event: KeyboardEvent) => !event.repeat && !isTyping() && action());
    }
}
