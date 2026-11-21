import Phaser from "phaser";
import { Callbacks, type Room } from "@colyseus/sdk";
import type { Direction, TownState } from "../../../server/src/rooms/schema/TownState.js";
import { DEPTH, FRAME, LABEL_OFFSET, dynamicsText } from "./look.js";

type View = { sprite: Phaser.GameObjects.Sprite; label: Phaser.GameObjects.Text };

/**
 * 畫面上的人：
 * - 打開小鎮的人：能走動的角色，名字後面加動態
 * - 在語音頻道裡、沒打開小鎮的人：站在語音房裡
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
            const { x, y } = character.position;
            const view = this.createView(x, y, character.name, "8px", FRAME[character.dir as Direction] ?? 0);
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
            view.sprite.setPosition(x, y).setFrame(FRAME[(isMe ? me.dir : character.dir) as Direction] ?? 0);
            view.label.setPosition(x, y - LABEL_OFFSET).setText(character.name + dynamicsText(voice?.get(character.userId)));
        });
        return this.updateVoiceFigures();
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
                view?.label.setVisible(false);
                return;
            }
            if (!view) {
                view = this.createView(figure.x, figure.y, "", "6px", FRAME.down);
                this.figures.set(userId, view);
            }
            view.sprite.setVisible(true).setPosition(figure.x, figure.y);
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

    private createView(x: number, y: number, name: string, fontSize: string, frame: number): View {
        return {
            sprite: this.scene.add.sprite(x, y, "hero", frame).setOrigin(0.5, 0.75).setDepth(DEPTH.character),
            label: this.scene.add
                .text(x, y - LABEL_OFFSET, name, { fontSize, color: "#fff", resolution: 3 })
                .setOrigin(0.5, 1)
                .setDepth(DEPTH.name),
        };
    }

    private destroy(view: View | undefined) {
        view?.sprite.destroy();
        view?.label.destroy();
    }
}
