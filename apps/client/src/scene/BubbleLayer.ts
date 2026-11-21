import Phaser from "phaser";
import type { Room } from "@colyseus/sdk";
import type { TownState } from "../../../server/src/rooms/schema/TownState.js";
import { DEPTH, LABEL_OFFSET } from "./look.js";

/** 打字的對話框顯示多久（毫秒）。 */
const BUBBLE_MS = 10_000;

type Bubble = { text: Phaser.GameObjects.Text; until: number };

/**
 * 角色頭上的對話框：
 * - 在 Discord 語音頻道的文字聊天打的字，顯示 10 秒
 * - 正在講話時顯示「…」（setSpeaking）；打字的對話框優先
 */
export class BubbleLayer {
    /** key 是帳號 ID。 */
    private bubbles = new Map<string, Bubble>();
    private speaking = new Set<string>();
    private scene: Phaser.Scene;
    /** 這位成員的角色現在畫在哪；看不到是 undefined。 */
    private positionOf: (userId: string) => { x: number; y: number } | undefined;

    constructor(scene: Phaser.Scene, room: Room<any, TownState>, positionOf: (userId: string) => { x: number; y: number } | undefined) {
        this.scene = scene;
        this.positionOf = positionOf;
        room.onMessage("bubble", ({ userId, text }: { userId: string; text: string }) => this.say(userId, text, scene.time.now + BUBBLE_MS));
    }

    /** 正在講話（顯示「…」）或停了。 */
    setSpeaking(userId: string, speaking: boolean) {
        if (speaking) this.speaking.add(userId);
        else this.speaking.delete(userId);
    }

    /** 每一幀：對話框跟著角色走；時間到的拿掉；講話中又沒有打字對話框的顯示「…」。 */
    update(time: number) {
        for (const userId of this.speaking) {
            const bubble = this.bubbles.get(userId);
            if (!bubble || bubble.until <= time) this.say(userId, "…", Infinity);
        }
        for (const [userId, bubble] of this.bubbles) {
            const where = this.positionOf(userId);
            const expired = bubble.until === Infinity ? !this.speaking.has(userId) : bubble.until <= time;
            if (expired) {
                bubble.text.destroy();
                this.bubbles.delete(userId);
                continue;
            }
            bubble.text.setVisible(!!where);
            if (where) bubble.text.setPosition(where.x, where.y - LABEL_OFFSET - 9);
        }
    }

    private say(userId: string, message: string, until: number) {
        const existing = this.bubbles.get(userId);
        if (existing) {
            existing.text.setText(message);
            existing.until = until;
            return;
        }
        // 文字是成員打的，Phaser 的 Text 不解析 HTML，直接顯示
        const text = this.scene.add
            .text(0, 0, message, {
                fontSize: "6px",
                color: "#222222",
                backgroundColor: "#ffffff",
                padding: { x: 3, y: 2 },
                resolution: 4,
                wordWrap: { width: 80, useAdvancedWrap: true },
                align: "center",
            })
            .setOrigin(0.5, 1)
            .setDepth(DEPTH.bubble);
        this.bubbles.set(userId, { text, until });
    }
}
