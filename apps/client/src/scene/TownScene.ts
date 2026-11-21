import Phaser from "phaser";
import { Callbacks, type Room } from "@colyseus/sdk";
import type { Direction, TownState } from "../../../server/src/rooms/schema/TownState.js";
import { CharacterLayer } from "./CharacterLayer.js";
import { MapView } from "./MapView.js";
import { PlayerController } from "./PlayerController.js";

/**
 * 小鎮的 Phaser 場景。把三個部分接起來：
 * - MapView：地圖、房間名稱、遊戲桌
 * - CharacterLayer：畫面上的人
 * - PlayerController：操作自己的角色
 */
export class TownScene extends Phaser.Scene {
    private map!: MapView;
    private characters!: CharacterLayer;
    private player!: PlayerController;

    private room: Room<any, TownState>;
    /** 手機搖桿的方向（長度 0～1），由 TouchControls 更新。 */
    private stick: { dx: number; dy: number };

    constructor(room: Room<any, TownState>, stick = { dx: 0, dy: 0 }) {
        super("town");
        this.room = room;
        this.stick = stick;
    }

    preload() {
        // 路徑不加開頭的 /，在 DC 裡才會套用 index.html 設的 .proxy/ 前綴
        this.load.svg("tiles", "maps/tiles.svg");
        this.load.spritesheet("hero", "sprites/hero.svg", { frameWidth: 16, frameHeight: 16 });
    }

    create() {
        // 畫面是 960×720，放大 3 倍等於看到地圖上 320×240 的範圍
        this.cameras.main.setZoom(3);

        this.map = new MapView(this);
        this.player = new PlayerController(this, this.room, this.stick);
        this.characters = new CharacterLayer(this, this.room, (sprite) => {
            const mine = this.room.state.characters.get(this.room.sessionId)!;
            this.player.startAt({ x: mine.position.x, y: mine.position.y, dir: mine.dir as Direction });
            this.cameras.main.startFollow(sprite, true);
        });

        // 地圖由伺服器依頻道清單產生，頻道變動時整份換掉
        Callbacks.get(this.room).listen("map", (json) => json && this.map.show(JSON.parse(json)), true);
    }

    update(time: number, delta: number) {
        this.player.update(time, delta, this.map.walkable);
        const streamingRooms = this.characters.update(delta, this.player.me);
        this.map.markStreaming(streamingRooms);
    }
}
