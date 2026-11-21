import type { Client } from "colyseus";
import { randomInt } from "node:crypto";
import { MoveRefused, PlatformUnavailable, platform } from "../../platform/platform.js";
import { roomAt } from "../../town/layoutTown.js";
import {
    OBJECT_KINDS, blockedTiles, canPlaceObject, centerOf, defaultFurniture, isObjectKind, roomOfObject, type BoardPost, type TownObject,
} from "../../town/objects.js";
import { PlacedObject } from "../schema/TownState.js";
import { TownFeature, type MessageHandler } from "./TownFeature.js";

/** 離家具中心多近才能互動（像素）。 */
const USE_RANGE = 28;
/** 揪團看板最多幾則；超過就把最舊的拿掉。 */
const MAX_POSTS = 8;
const MAX_TITLE = 40;
const MAX_URL = 300;
/** 坐在椅子上時 seatedAt 的前綴（遊戲桌用的是桌子 ID）。 */
const CHAIR = "chair:";

/**
 * 家具（town/objects.ts）：
 * - 椅子：按 E 坐下、再按一次起身
 * - 電腦：揪團看板，貼遊戲房間的連結讓大家點進去加入
 * - 電視：看這個語音房裡誰在直播，一鍵搬進語音頻道去看
 * - 管理員用編輯器擺放、移除家具；還沒擺過的小鎮每個房間有預設的家具
 */
export class Furniture extends TownFeature {
    /** 現在擺在地圖上的家具（放得下的那些）。 */
    private objects: TownObject[] = [];

    messages(): Record<string, MessageHandler> {
        return {
            placeObject: (client, payload) => void this.edit(client, () => this.place(payload)),
            removeObject: (client, payload) => void this.edit(client, () => this.remove(payload)),
            resetObjects: (client) => void this.edit(client, () => this.reset()),
            postBoard: (client, payload) => this.post(client, payload),
            removeBoardPost: (client, payload) => this.unpost(client, payload),
            watchTv: (client, payload) => void this.watchTv(client, payload),
        };
    }

    /** 按 E：坐在椅子上就起身；旁邊有能互動的家具就用它。 */
    interact(client: Client) {
        const me = this.town.state.characters.get(client.sessionId);
        if (!me) return false;
        if (me.seatedAt.startsWith(CHAIR)) {
            this.standUp(client.sessionId);
            return true;
        }
        if (me.seatedAt) return false; // 坐在遊戲桌，交給遊戲桌
        const target = this.nearest(me.position);
        if (!target) return false;
        const interaction = OBJECT_KINDS[target.kind].interaction;
        if (interaction === "sit") this.sit(client, target);
        else client.send("openObject", { id: target.id, kind: target.kind });
        return true;
    }

    onLeave(client: Client) {
        this.standUp(client.sessionId);
    }

    /** 地圖換了：家具照設定重擺，放不下的先收起來（設定還在）。 */
    async onLayoutChanged() {
        this.sync();
    }

    // ── 椅子 ────────────────────────────────────────────────

    private sit(client: Client, chair: TownObject) {
        const placed = this.town.state.objects.get(chair.id)!;
        if (placed.sittingBy) return client.send("tableResult", { ok: false, message: "這張椅子有人坐了" });
        const me = this.town.state.characters.get(client.sessionId)!;
        const seat = centerOf(chair, this.town.layout.map.tilewidth);
        placed.sittingBy = client.sessionId;
        me.seatedAt = CHAIR + chair.id;
        me.position.x = seat.x;
        me.position.y = seat.y;
        this.town.placeIn(client.sessionId, roomAt(this.town.layout.rooms, seat.x, seat.y), "other");
        this.town.holdStill(client.sessionId);
    }

    private standUp(sessionId: string) {
        const me = this.town.state.characters.get(sessionId);
        if (!me?.seatedAt.startsWith(CHAIR)) return;
        const placed = this.town.state.objects.get(me.seatedAt.slice(CHAIR.length));
        if (placed?.sittingBy === sessionId) placed.sittingBy = "";
        me.seatedAt = "";
        this.town.holdStill(sessionId);
    }

    // ── 電腦的揪團看板 ───────────────────────────────────────

    /** 貼一則揪團：要站在那台電腦旁邊；連結只接受 http、https。 */
    private post(client: Client, payload: unknown) {
        const tell = (ok: boolean, message: string) => client.send("boardResult", { ok, message });
        const args = (payload ?? {}) as { id?: unknown; title?: unknown; url?: unknown };
        const computer = this.usable(client, args.id, "computer");
        if (!computer) return tell(false, "要站在電腦旁邊才能貼");
        const title = typeof args.title === "string" ? args.title.trim() : "";
        if (!title || title.length > MAX_TITLE) return tell(false, `標題要 1～${MAX_TITLE} 個字`);
        const url = typeof args.url === "string" ? args.url.trim() : "";
        if (!isWebLink(url) || url.length > MAX_URL) return tell(false, "連結要是 http 或 https 開頭的網址");
        const posts = this.town.townSettings.board(this.town.guildId, computer.id);
        posts.push({ title, url, by: client.auth.name, userId: client.auth.id, at: Date.now() });
        this.saveBoard(computer.id, posts.slice(-MAX_POSTS));
        tell(true, "貼上去了");
    }

    /** 拿掉自己貼的一則。 */
    private unpost(client: Client, payload: unknown) {
        const args = (payload ?? {}) as { id?: unknown; at?: unknown };
        const computer = this.objects.find((o) => o.id === args.id && o.kind === "computer");
        if (!computer) return;
        const posts = this.town.townSettings.board(this.town.guildId, computer.id);
        const kept = posts.filter((p) => !(p.at === args.at && p.userId === client.auth.id));
        if (kept.length !== posts.length) this.saveBoard(computer.id, kept);
    }

    private saveBoard(id: string, posts: BoardPost[]) {
        this.town.townSettings.setBoard(this.town.guildId, id, posts);
        const placed = this.town.state.objects.get(id);
        if (placed) placed.board = JSON.stringify(posts);
    }

    // ── 電視 ────────────────────────────────────────────────

    /** 去看直播：把成員搬進電視所在的語音頻道（Activity 裡沒辦法直接播 Discord 的直播畫面）。 */
    private async watchTv(client: Client, payload: unknown) {
        const tell = (ok: boolean, message: string) => client.send("voiceMove", { ok, message });
        const tv = this.usable(client, (payload as { id?: unknown } | null)?.id, "tv");
        if (!tv) return tell(false, "要站在電視旁邊");
        const room = roomOfObject(tv, this.town.layout);
        if (room?.kind !== "voice") return tell(false, "這台電視不在語音房裡");
        try {
            const result = await platform().moveToVoice(this.town.guildId, client.auth.id, room.id);
            if (result === "not-in-voice") tell(false, "請先在 Discord 加入任一個語音頻道，才能幫你切過去看直播");
            else tell(true, `已切到「${room.name}」，在 Discord 點直播畫面就能看`);
        } catch (e) {
            if (e instanceof MoveRefused) tell(false, e.message);
            else if (e instanceof PlatformUnavailable) tell(false, "暫時連不上 Discord");
            else {
                console.error("電視搬頻道失敗", e);
                tell(false, "切換語音頻道失敗，請稍後再試");
            }
        }
    }

    // ── 管理員的家具編輯器 ────────────────────────────────────

    private async edit(client: Client, run: () => string) {
        const tell = (ok: boolean, message: string) => client.send("adminResult", { ok, message });
        const isAdmin = await platform().isAdmin(this.town.guildId, client.auth.id).catch(() => false);
        if (!isAdmin) return tell(false, "只有管理員（有「管理伺服器」權限）能擺家具");
        try {
            tell(true, run());
        } catch (e) {
            if (!(e instanceof EditError)) throw e;
            tell(false, e.message);
        }
    }

    /** 放一件家具在指定的格子。 */
    private place(payload: unknown) {
        const { kind, x, y } = (payload ?? {}) as { kind?: unknown; x?: unknown; y?: unknown };
        if (!isObjectKind(kind)) throw new EditError("要選一種家具");
        if (!Number.isInteger(x) || !Number.isInteger(y)) throw new EditError("位置不對");
        const placed: TownObject = { id: `obj-${Date.now().toString(36)}-${randomInt(1000)}`, kind, x: x as number, y: y as number };
        if (!canPlaceObject(placed, this.town.layout, this.town.baseWalkable, this.objects)) throw new EditError("這裡放不下：會卡到牆或別的家具");
        this.save([...this.placements(), placed]);
        return `放了${OBJECT_KINDS[kind].name}`;
    }

    private remove(payload: unknown) {
        const id = (payload as { id?: unknown } | null)?.id;
        const target = this.placements().find((o) => o.id === id);
        if (!target) throw new EditError("找不到這件家具");
        this.save(this.placements().filter((o) => o.id !== id));
        return `移除了${OBJECT_KINDS[target.kind].name}`;
    }

    private reset() {
        this.town.townSettings.setObjects(this.town.guildId, undefined);
        this.sync();
        return "家具改回預設的擺法";
    }

    private placements() {
        return this.town.townSettings.objects(this.town.guildId) ?? defaultFurniture(this.town.layout);
    }

    private save(objects: TownObject[]) {
        this.town.townSettings.setObjects(this.town.guildId, objects);
        this.sync();
    }

    // ── 讓地圖上的家具跟設定一致 ──────────────────────────────

    private sync() {
        const { layout, baseWalkable, state } = this.town;
        const fits: TownObject[] = [];
        for (const o of this.placements()) if (canPlaceObject(o, layout, baseWalkable, fits)) fits.push(o);
        const wanted = new Map(fits.map((o) => [o.id, o]));

        state.objects.forEach((placed, id) => {
            const next = wanted.get(id);
            if (next && next.kind === placed.kind && next.x === placed.x && next.y === placed.y) return;
            if (placed.sittingBy) this.standUp(placed.sittingBy);
            state.objects.delete(id);
        });
        for (const o of fits) {
            if (state.objects.has(o.id)) continue;
            const board = o.kind === "computer" ? JSON.stringify(this.town.townSettings.board(this.town.guildId, o.id)) : "[]";
            state.objects.set(o.id, new PlacedObject({ kind: o.kind, x: o.x, y: o.y, board }));
        }
        this.objects = fits;
        this.town.setBlockedTiles(blockedTiles(fits, layout.map.width));
    }

    /** 離這個位置最近、範圍內、可以互動的家具。 */
    private nearest(position: { x: number; y: number }) {
        const tile = this.town.layout.map.tilewidth;
        let best: TownObject | undefined;
        let bestDistance = USE_RANGE;
        for (const o of this.objects) {
            if (OBJECT_KINDS[o.kind].interaction === "none") continue;
            const c = centerOf(o, tile);
            const distance = Math.hypot(c.x - position.x, c.y - position.y);
            if (distance <= bestDistance) [best, bestDistance] = [o, distance];
        }
        return best;
    }

    /** 成員旁邊、這個 ID、這一種的家具；不在旁邊或不對就是 undefined。 */
    private usable(client: Client, id: unknown, kind: TownObject["kind"]) {
        const me = this.town.state.characters.get(client.sessionId);
        const o = this.objects.find((x) => x.id === id && x.kind === kind);
        if (!me || !o) return undefined;
        const c = centerOf(o, this.town.layout.map.tilewidth);
        return Math.hypot(c.x - me.position.x, c.y - me.position.y) <= USE_RANGE + 8 ? o : undefined;
    }
}

/** 編輯器不允許的操作。訊息會直接顯示給管理員看。 */
class EditError extends Error {}

function isWebLink(url: string) {
    try {
        return ["http:", "https:"].includes(new URL(url).protocol);
    } catch {
        return false;
    }
}
