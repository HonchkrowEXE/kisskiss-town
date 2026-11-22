import Phaser from "phaser";
import { Callbacks, type Room } from "@colyseus/sdk";
import type { Direction, TownState } from "../../../server/src/rooms/schema/TownState.js";
import { OBJECT_KINDS } from "../../../server/src/town/objects.js";
import { BubbleLayer } from "./BubbleLayer.js";
import { CharacterLayer } from "./CharacterLayer.js";
import { MapView } from "./MapView.js";
import { ObjectLayer } from "./ObjectLayer.js";
import { PlayerController } from "./PlayerController.js";
import { TableLayer } from "./TableLayer.js";
import type { EditorTool } from "../ui/FurnitureEditor.js";
import { CallMenu } from "../ui/CallMenu.js";

/** 畫面短邊要看得到地圖上多少像素（大約 16 格）。 */
const VIEW_SIZE = 260;

/**
 * 小鎮的 Phaser 場景。把這幾個部分接起來：
 * - MapView：地圖、房間名稱
 * - ObjectLayer：家具；TableLayer：遊戲桌
 * - CharacterLayer：畫面上的人
 * - PlayerController：操作自己的角色（點地圖空的地方就走過去）
 * 管理員打開家具編輯器時，點地圖的格子就放（或移除）家具。
 */
export class TownScene extends Phaser.Scene {
    private map!: MapView;
    private objects!: ObjectLayer;
    private characters!: CharacterLayer;
    private player!: PlayerController;
    private bubbles!: BubbleLayer;
    /** 編輯器開著時跟著滑鼠的虛線框，表示家具會放在哪。 */
    private cursor?: Phaser.GameObjects.Rectangle;

    private room: Room<any, TownState>;
    /** 手機搖桿的方向（長度 0～1），由 TouchControls 更新。 */
    private stick: { dx: number; dy: number };
    /** 家具編輯器現在選的工具；沒開編輯器是 null。由 FurnitureEditor 更新。 */
    private editor: { tool: EditorTool | null };

    /** 點身邊的人跳出的選單。 */
    private callMenu: CallMenu;

    constructor(room: Room<any, TownState>, stick = { dx: 0, dy: 0 }, editor: { tool: EditorTool | null } = { tool: null }, callMenu = new CallMenu(room)) {
        super("town");
        this.room = room;
        this.stick = stick;
        this.editor = editor;
        this.callMenu = callMenu;
    }

    preload() {
        // 路徑不加開頭的 /，在 DC 裡才會套用 index.html 設的 .proxy/ 前綴
        this.load.svg("tiles", "maps/tiles.svg");
        // 角色圖、家具圖不用載入：在 characterArt、objectArt 裡畫出來
    }

    create() {
        // 畫布跟著視窗大小（直式手機也填滿），鏡頭放大到短邊看得到地圖上 VIEW_SIZE 像素
        this.fitCamera();
        this.scale.on("resize", () => this.fitCamera());

        this.map = new MapView(this);
        this.objects = new ObjectLayer(this, this.room, (objects) => this.map.setFurniture(objects));
        new TableLayer(this, this.room);
        this.player = new PlayerController(this, this.room, this.stick);
        this.characters = new CharacterLayer(this, this.room, (sprite) => {
            const mine = this.room.state.characters.get(this.room.sessionId)!;
            this.player.startAt({ x: mine.position.x, y: mine.position.y, dir: mine.dir as Direction });
            this.cameras.main.startFollow(sprite, true);
        });

        this.bubbles = new BubbleLayer(this, this.room, (userId) => this.characters.positionOf(userId));

        // 地圖由伺服器依頻道清單產生，頻道變動時整份換掉
        Callbacks.get(this.room).listen("map", (json) => json && this.map.show(JSON.parse(json)), true);

        this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => this.editAt(pointer));
    }

    /**
     * 點地圖：
     * - 編輯器開著時，橡皮擦移除那格的家具，其他工具在那格放家具
     * - 平常點到人，跳出角色選單（一對一通話）；點到其他地方，走過去
     */
    private editAt(pointer: Phaser.Input.Pointer) {
        const tool = this.editor.tool;
        const map = this.map.current?.map;
        if (!tool) return this.pickCharacter(pointer);
        if (!map) return;
        const x = Math.floor(pointer.worldX / map.tilewidth);
        const y = Math.floor(pointer.worldY / map.tileheight);
        if (tool === "remove") {
            const target = this.objects.at(x, y, map.width);
            if (target) this.room.send("removeObject", { id: target.id });
        } else {
            this.room.send("placeObject", { kind: tool, x, y });
        }
    }

    private pickCharacter(pointer: Phaser.Input.Pointer) {
        const sessionId = this.characters.sessionAt(pointer.worldX, pointer.worldY);
        const target = sessionId ? this.room.state.characters.get(sessionId) : undefined;
        const me = this.player.me;
        if (!sessionId || !target) {
            this.callMenu.close();
            return this.player.walkTo({ x: pointer.worldX, y: pointer.worldY }, this.map.walkable, this.map.current?.map);
        }
        this.callMenu.open(sessionId, Math.hypot(target.position.x - me.x, target.position.y - me.y) <= CallMenu.RANGE);
    }

    /** 依畫面大小決定放大倍率：桌機大約跟以前一樣（短邊看到 260px），直式手機不會縮到看不清楚。 */
    private fitCamera() {
        const { width, height } = this.scale;
        this.cameras.main.setZoom(Math.max(1, Math.min(width, height) / VIEW_SIZE));
    }

    update(time: number, delta: number) {
        this.player.update(time, delta, this.map.walkable);
        const streamingRooms = this.characters.update(delta, this.player.me);
        this.map.markStreaming(streamingRooms);
        this.bubbles.update(time);
        this.updateCursor();
    }

    /** 編輯器的虛線框：跟著滑鼠對齊格子，大小是選的家具大小。 */
    private updateCursor() {
        const tool = this.editor.tool;
        if (!tool) return this.cursor?.setVisible(false);
        const pointer = this.input.activePointer;
        const { width, height } = tool === "remove" ? { width: 1, height: 1 } : OBJECT_KINDS[tool];
        this.cursor ??= this.add.rectangle(0, 0, 16, 16).setOrigin(0, 0).setDepth(20).setStrokeStyle(1, 0xffffff).setFillStyle(0xffffff, 0.15);
        this.cursor
            .setVisible(true)
            .setSize(width * 16, height * 16)
            .setPosition(Math.floor(pointer.worldX / 16) * 16, Math.floor(pointer.worldY / 16) * 16)
            .setStrokeStyle(1, tool === "remove" ? 0xff6666 : 0xffffff);
    }
}
