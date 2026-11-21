import Phaser from "phaser";
import { Callbacks, type Room } from "@colyseus/sdk";
import type { Direction, TownState } from "../../../server/src/rooms/schema/TownState.js";
import { DEFAULT_APPEARANCE, appearanceFromJson } from "../../../server/src/town/appearance.js";
import { STEPS, characterTexture, directionIndex } from "./characterArt.js";
import { DEPTH, LABEL_OFFSET, dynamicsText } from "./look.js";

/** 走路時每一步多久（毫秒）。 */
const STEP_MS = 150;

type View = {
    sprite: Phaser.GameObjects.Sprite;
    /** 腳底的淡影子。 */
    shadow: Phaser.GameObjects.Ellipse;
    label: Phaser.GameObjects.Text;
    /** 目前用的外觀 JSON；變了就換一張角色圖。 */
    look: string;
    /** 連續走了多久（毫秒）；停下來歸零，用來算現在是哪一步。 */
    walking: number;
};

/**
 * 畫面上的人：
 * - 打開小鎮的人：照自己的外觀畫、走路有動畫，名字後面加動態
 * - 在語音頻道裡、沒打開小鎮的人：用預設外觀站在語音房裡
 */
export class CharacterLayer {
    /** 打開小鎮的人，key 是 sessionId。 */
    private characters = new Map<string, View>();
    /** 語音頻道裡、沒打開小鎮的人，key 是帳號 ID。 */
    private figures = new Map<string, View>();
    private scene: Phaser.Scene;
    private room: Room<any, TownState>;

    /** onMeAdded：自己的角色畫好時呼叫（鏡頭要跟著它）。 */
    constructor(scene: Phaser.Scene, room: Room<any, TownState>, onMeAdded: (sprite: Phaser.GameObjects.Sprite) => void) {
        this.scene = scene;
        this.room = room;
        const callbacks = Callbacks.get(room);
        callbacks.onAdd("characters", (character, sessionId) => {
            const view = this.createView(character.position.x, character.position.y, character.name, "8px", character.look);
            this.characters.set(sessionId, view);
            if (sessionId === room.sessionId) onMeAdded(view.sprite);
        });
        callbacks.onRemove("characters", (_character, sessionId) => {
            this.destroy(this.characters.get(sessionId));
            this.characters.delete(sessionId);
        });
        // 有人被搧：所有人都看到對方閃一下、跳出「啪！」
        room.onMessage("slap", ({ to }: { from: string; to: string }) => this.playSlap(to));
    }

    /** 每一幀：別人往伺服器上的位置滑過去，自己直接用 me（前端算的位置）。回傳有人直播的語音房。 */
    update(delta: number, me: { x: number; y: number; dir: Direction }) {
        const { characters, voice } = this.room.state;
        characters?.forEach((character, sessionId) => {
            const view = this.characters.get(sessionId);
            if (!view) return;
            const isMe = sessionId === this.room.sessionId;
            const target = isMe ? me : character.position;
            const t = isMe ? 1 : Math.min(1, delta / 100);
            const x = Phaser.Math.Linear(view.sprite.x, target.x, t);
            const y = Phaser.Math.Linear(view.sprite.y, target.y, t);
            const moved = Math.hypot(x - view.sprite.x, y - view.sprite.y) > 0.05;
            if (character.look !== view.look) this.setLook(view, character.look);
            view.walking = moved ? view.walking + delta : 0;
            view.sprite.setPosition(x, y).setFrame(this.frameOf(isMe ? me.dir : character.dir, view.walking));
            view.shadow.setPosition(x, y + 3);
            view.label.setPosition(x, y - LABEL_OFFSET).setText(character.name + dynamicsText(voice?.get(character.userId)));
        });
        return this.updateVoiceFigures();
    }

    /** 這位成員的角色現在畫在哪（打開小鎮的人，或站在語音房裡的人）；看不到是 undefined。 */
    positionOf(userId: string): { x: number; y: number } | undefined {
        let found: { x: number; y: number } | undefined;
        this.room.state.characters?.forEach((character, sessionId) => {
            const view = this.characters.get(sessionId);
            if (!found && view && character.userId === userId) found = { x: view.sprite.x, y: view.sprite.y };
        });
        const figure = this.figures.get(userId);
        if (!found && figure?.sprite.visible) found = { x: figure.sprite.x, y: figure.sprite.y };
        return found;
    }

    /** 點到哪個人（打開小鎮的人，不含自己）；沒點到是 undefined。 */
    sessionAt(x: number, y: number): string | undefined {
        for (const [sessionId, view] of this.characters) {
            if (sessionId === this.room.sessionId) continue;
            const { x: sx, y: sy } = view.sprite;
            // 角色圖 16×16、原點在腳底上方：點到身體或頭都算
            if (Math.abs(x - sx) <= 8 && y >= sy - 14 && y <= sy + 4) return sessionId;
        }
        return undefined;
    }

    /** 面向和走了多久 → 角色圖的第幾格。停著是站姿，走路時左右腳輪流。 */
    private frameOf(dir: string, walking: number) {
        const step = walking > 0 ? 1 + (Math.floor(walking / STEP_MS) % 2) : 0;
        return directionIndex(dir) * STEPS + step;
    }

    /** 語音頻道裡、沒打開小鎮的人站在語音房裡；有打開小鎮的人已經用能走動的角色顯示，這裡藏起來。 */
    private updateVoiceFigures() {
        const streamingRooms = new Set<string>();
        const voice = this.room.state.voice;
        if (!voice) return streamingRooms;
        const inTown = new Set<string>();
        this.room.state.characters?.forEach((character) => inTown.add(character.userId));

        voice.forEach((figure, userId) => {
            if (figure.streaming) streamingRooms.add(figure.channelId);
            let view = this.figures.get(userId);
            if (inTown.has(userId)) {
                view?.sprite.setVisible(false);
                view?.shadow.setVisible(false);
                view?.label.setVisible(false);
                return;
            }
            if (!view) {
                view = this.createView(figure.x, figure.y, "", "6px", "");
                this.figures.set(userId, view);
            }
            view.sprite.setVisible(true).setPosition(figure.x, figure.y);
            view.shadow.setVisible(true).setPosition(figure.x, figure.y + 3);
            view.label.setVisible(true).setPosition(figure.x, figure.y - LABEL_OFFSET).setText(figure.name + dynamicsText(figure));
        });

        for (const [userId, view] of this.figures) {
            if (voice.has(userId)) continue;
            this.destroy(view);
            this.figures.delete(userId);
        }
        return streamingRooms;
    }

    /** 被搧的角色閃紅、頭上跳出「啪！」往上飄走。 */
    private playSlap(sessionId: string) {
        const view = this.characters.get(sessionId);
        if (!view) return;
        view.sprite.setTint(0xff6666);
        this.scene.time.delayedCall(200, () => view.sprite.active && view.sprite.clearTint()); // 對方可能已經離開
        const pop = this.scene.add
            .text(view.sprite.x, view.sprite.y - LABEL_OFFSET - 6, "啪！", { fontSize: "8px", color: "#ffeb3b", resolution: 3, stroke: "#000", strokeThickness: 2 })
            .setOrigin(0.5, 1)
            .setDepth(DEPTH.name);
        this.scene.tweens.add({ targets: pop, y: pop.y - 10, alpha: 0, duration: 600, onComplete: () => pop.destroy() });
    }

    private createView(x: number, y: number, name: string, fontSize: string, look: string): View {
        const texture = characterTexture(this.scene, look ? appearanceFromJson(look) : DEFAULT_APPEARANCE);
        return {
            sprite: this.scene.add.sprite(x, y, texture, 0).setOrigin(0.5, 0.75).setDepth(DEPTH.character),
            shadow: this.scene.add.ellipse(x, y + 3, 10, 3, 0x000000, 0.25).setDepth(DEPTH.character - 0.5),
            label: this.scene.add
                // 黑色描邊：在淺色地毯上也看得清楚
                .text(x, y - LABEL_OFFSET, name, { fontSize, color: "#fff", resolution: 3, stroke: "#000", strokeThickness: 2 })
                .setOrigin(0.5, 1)
                .setDepth(DEPTH.name),
            look,
            walking: 0,
        };
    }

    private setLook(view: View, look: string) {
        view.look = look;
        view.sprite.setTexture(characterTexture(this.scene, appearanceFromJson(look)), 0);
    }

    private destroy(view: View | undefined) {
        view?.sprite.destroy();
        view?.shadow.destroy();
        view?.label.destroy();
    }
}
