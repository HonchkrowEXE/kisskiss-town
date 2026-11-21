import Phaser from "phaser";
import { Callbacks, type Room } from "@colyseus/sdk";
import type { TownState } from "../../../server/src/rooms/schema/TownState.js";
import { OBJECT_KINDS, footprint, isObjectKind, type TownObject } from "../../../server/src/town/objects.js";
import { DEPTH } from "./look.js";
import { objectTexture } from "./objectArt.js";

/** 地圖上的家具：照同步狀態畫出來；家具一變就通知（碰撞判斷要跟著改）。 */
export class ObjectLayer {
    private images = new Map<string, Phaser.GameObjects.Image>();
    private room: Room<any, TownState>;

    /** onChange：家具清單變了（新增、移除）時呼叫。 */
    constructor(scene: Phaser.Scene, room: Room<any, TownState>, onChange: (objects: TownObject[]) => void) {
        this.room = room;
        const callbacks = Callbacks.get(room);
        callbacks.onAdd("objects", (o, id) => {
            if (!isObjectKind(o.kind)) return;
            const image = scene.add.image(o.x * 16, o.y * 16, objectTexture(scene, o.kind)).setOrigin(0, 0).setDepth(DEPTH.object);
            this.images.set(id, image);
            queueMicrotask(() => onChange(this.list()));
        });
        callbacks.onRemove("objects", (_o, id) => {
            this.images.get(id)?.destroy();
            this.images.delete(id);
            queueMicrotask(() => onChange(this.list()));
        });
    }

    /** 現在的家具清單。 */
    list(): TownObject[] {
        const objects: TownObject[] = [];
        this.room.state.objects?.forEach((o, id) => isObjectKind(o.kind) && objects.push({ id, kind: o.kind, x: o.x, y: o.y }));
        return objects;
    }

    /** 蓋住這一格的家具（編輯器點地圖時用）。 */
    at(tx: number, ty: number, mapWidth: number) {
        const tile = ty * mapWidth + tx;
        return this.list().find((o) => footprint(o, mapWidth).includes(tile));
    }
}

export { OBJECT_KINDS };
