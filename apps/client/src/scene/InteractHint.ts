import Phaser from "phaser";
import type { Room } from "@colyseus/sdk";
import type { TownState } from "../../../server/src/rooms/schema/TownState.js";
import { OBJECT_KINDS, centerOf, isObjectKind } from "../../../server/src/town/objects.js";
import { GAME_TITLES, type GameKind } from "../../../server/src/town/tables.js";
import { DEPTH } from "./look.js";

const TILE = 16;
/** 遊戲桌圖的一半寬高（TableLayer 的桌子是 28×18）。 */
const TABLE_HALF = { w: 14, h: 9 };

/** 滑鼠下面一件能互動的東西：ID（送給伺服器）、提示文字、提示放哪、要走到哪才用得到。 */
export type Interactable = { id: string; label: string; anchor: { x: number; y: number }; approach: { x: number; y: number } };

/** 每種家具互動的說法。 */
const VERBS = { board: "看揪團看板", tv: "看電視" } as const;

/**
 * 滑鼠移到椅子、電腦、電視、遊戲桌上時，上面跳出「🖱 坐下」之類的提示，游標變成手指。
 * 點下去要做什麼由 TownScene 決定（走過去再互動）；這裡只負責找東西和顯示提示。
 */
export class InteractHint {
    private label: Phaser.GameObjects.Text;
    private scene: Phaser.Scene;
    private room: Room<any, TownState>;

    constructor(scene: Phaser.Scene, room: Room<any, TownState>) {
        this.scene = scene;
        this.room = room;
        this.label = scene.add
            .text(0, 0, "", { fontSize: "8px", resolution: 3, color: "#ffffff", backgroundColor: "#1d140fdd", padding: { x: 3, y: 2 } })
            .setOrigin(0.5, 1)
            .setDepth(DEPTH.bubble + 1)
            .setVisible(false);
    }

    /** 這個位置（地圖像素）底下能互動的東西；沒有就是 undefined。 */
    at(x: number, y: number): Interactable | undefined {
        const { characters, objects, tables } = this.room.state;
        const mySeat = characters?.get(this.room.sessionId)?.seatedAt ?? "";

        let found: Interactable | undefined;
        objects?.forEach((o, id) => {
            if (found || !isObjectKind(o.kind)) return;
            const { width, height, interaction } = OBJECT_KINDS[o.kind];
            if (interaction === "none") return;
            if (x < o.x * TILE || x >= (o.x + width) * TILE || y < o.y * TILE || y >= (o.y + height) * TILE) return;
            const label =
                interaction === "sit" ? (mySeat === `chair:${id}` ? "起身" : o.sittingBy ? "有人坐了" : "坐下") : VERBS[interaction];
            const center = centerOf({ id, kind: o.kind, x: o.x, y: o.y }, TILE);
            found = { id, label, anchor: { x: center.x, y: o.y * TILE }, approach: center };
        });
        tables?.forEach((t, id) => {
            if (found || Math.abs(x - t.x) > TABLE_HALF.w || Math.abs(y - t.y) > TABLE_HALF.h) return;
            const label = mySeat === id ? "起身" : `入座：${GAME_TITLES[t.game as GameKind] ?? "遊戲桌"}`;
            // 桌子下方正中間的座位附近，伺服器會把人放到空的座位上
            found = { id, label, anchor: { x: t.x, y: t.y - TABLE_HALF.h }, approach: { x: t.x, y: t.y + 20 } };
        });
        return found;
    }

    /** 每一幀：滑鼠在能互動的東西上就顯示提示。編輯家具時不顯示。 */
    update(enabled: boolean) {
        const pointer = this.scene.input.activePointer;
        const thing = enabled ? this.at(pointer.worldX, pointer.worldY) : undefined;
        this.scene.input.setDefaultCursor(thing ? "pointer" : "");
        if (!thing) return this.label.setVisible(false);
        this.label.setText(`🖱 ${thing.label}`).setPosition(thing.anchor.x, thing.anchor.y - 2).setVisible(true);
    }
}
