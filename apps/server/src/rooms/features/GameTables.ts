import type { Client } from "colyseus";
import { randomInt } from "node:crypto";
import { platform } from "../../platform/platform.js";
import {
    GAME_KINDS, GAME_TITLES, TABLE_SPACING, canPlaceTable, defaultTables, seatsAround, type GameKind, type TablePlacement,
} from "../../town/tables.js";
import { GameTable } from "../schema/TownState.js";
import { memberOf } from "../Town.js";
import { TownFeature, type MessageHandler } from "./TownFeature.js";
import { BlackjackGame } from "./tables/BlackjackGame.js";
import { DiceDuelGame } from "./tables/DiceDuelGame.js";
import { LiarDiceGame } from "./tables/LiarDiceGame.js";
import { GameError, type TableContext, type TableGame, type TableSeat } from "./tables/TableGame.js";

/** 離遊戲桌中心多近才能入座（像素）。 */
const SIT_RANGE = 40;

/** 一張擺在地圖上的桌子：位置、上面的遊戲、坐著的人（key 是 sessionId）。 */
type LiveTable = { placement: TablePlacement; game: TableGame; seats: Map<string, TableSeat> };

/**
 * 遊戲桌：走到桌旁按 E 入座，玩那張桌子的遊戲（每種遊戲是 tables/ 底下的一個類別）。
 * 管理員可以擺放、搬移、移除桌子，存在資料庫裡；還沒擺過的小鎮用預設的三張。
 */
export class GameTables extends TownFeature {
    private tables = new Map<string, LiveTable>();

    messages(): Record<string, MessageHandler> {
        return {
            sit: (client) => this.sit(client),
            stand: (client) => this.stand(client.sessionId),
            tableAction: (client, payload) => this.act(client, payload),
            placeTable: (client, payload) => void this.edit(client, () => this.place(client, payload)),
            moveTable: (client, payload) => void this.edit(client, () => this.move(client, payload)),
            removeTable: (client, payload) => void this.edit(client, () => this.remove(payload)),
        };
    }

    /** 按 E：坐在遊戲桌就起身；旁邊有遊戲桌就入座；都不是就交給下一個功能。 */
    interact(client: Client) {
        const me = this.town.state.characters.get(client.sessionId);
        if (!me) return false;
        if (this.tables.has(me.seatedAt)) {
            this.stand(client.sessionId);
            return true;
        }
        if (me.seatedAt || !this.nearestTable(me.position)) return false;
        this.sit(client);
        return true;
    }

    private nearestTable(position: { x: number; y: number }) {
        return [...this.tables.values()].find((t) => Math.hypot(t.placement.x - position.x, t.placement.y - position.y) <= SIT_RANGE);
    }

    /** 斷線視為起身，由各遊戲決定怎麼處理這一局（退出、算停牌、算輸）。 */
    onLeave(client: Client) {
        this.stand(client.sessionId);
    }

    /** 地圖換了：桌子照設定重擺，放不下的先收起來（設定還在）。 */
    async onLayoutChanged() {
        this.sync();
    }

    // ── 入座與遊戲動作 ──────────────────────────────────────────

    /** 走到遊戲桌旁入座：站到空的座位上，坐著時不能走動。 */
    private sit(client: Client) {
        const me = this.town.state.characters.get(client.sessionId);
        if (!me) return;
        const tell = (ok: boolean, message: string) => client.send("tableResult", { ok, message });
        if (me.seatedAt) return tell(false, "已經坐在遊戲桌了");
        let seatedElsewhere = false;
        this.town.forEachCharacterOf(client.auth.id, (character) => (seatedElsewhere ||= character !== me && !!character.seatedAt));
        if (seatedElsewhere) return tell(false, "你已經在另一個分頁入座了");

        const live = this.nearestTable(me.position);
        if (!live) return tell(false, "旁邊沒有遊戲桌");
        const table = this.town.state.tables.get(live.placement.id)!;
        const index = table.seats.indexOf("");
        if (index === -1) return tell(false, "這桌坐滿了");

        const seat = seatsAround(live.placement.x, live.placement.y)[index];
        table.seats[index] = client.sessionId;
        live.seats.set(client.sessionId, { sessionId: client.sessionId, owner: memberOf(client), name: client.auth.name });
        me.seatedAt = live.placement.id;
        me.position.x = seat.x;
        me.position.y = seat.y;
        this.town.placeIn(client.sessionId, undefined, "other");
        // 入座前前端送出、還在路上的移動不能把人拉離座位
        this.town.holdStill(client.sessionId);
        this.publish(live.placement.id);
        tell(true, `入座了：${GAME_TITLES[live.placement.game]}`);
    }

    /** 起身（按 E、斷線、桌子被搬走）：讓出座位，再讓遊戲處理這一局。 */
    private stand(sessionId: string) {
        const me = this.town.state.characters.get(sessionId);
        const live = me?.seatedAt ? this.tables.get(me.seatedAt) : undefined;
        if (!me || !live) return;
        const table = this.town.state.tables.get(live.placement.id)!;
        const index = table.seats.indexOf(sessionId);
        if (index !== -1) table.seats[index] = "";
        me.seatedAt = "";
        const seat = live.seats.get(sessionId)!;
        live.seats.delete(sessionId);
        this.town.clientOf(sessionId)?.send("tablePrivate", { tableId: live.placement.id, data: null });
        live.game.onSeatLeft(seat);
        // 起身後從座位重新累積移動額度
        this.town.holdStill(sessionId);
    }

    /** 遊戲動作（下注、要牌、喊價…）交給那張桌子的遊戲。payload 來自前端：{ action, ...參數 }。 */
    private act(client: Client, payload: unknown) {
        const tell = (message: string) => client.send("tableResult", { ok: false, message });
        const tableId = this.town.state.characters.get(client.sessionId)?.seatedAt;
        const live = tableId ? this.tables.get(tableId) : undefined;
        if (!live) return tell("先入座才能玩");
        const args = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
        const action = typeof args.action === "string" ? live.game.actions()[args.action] : undefined;
        if (!action) return tell("這張桌子沒有這個動作");
        try {
            action(live.seats.get(client.sessionId)!, args);
        } catch (e) {
            if (!(e instanceof GameError)) throw e;
            tell(e.message);
        }
    }

    // ── 管理員擺桌子 ────────────────────────────────────────────

    /** 管理員的編輯動作：先向平台確認是管理員，結果告訴他。 */
    private async edit(client: Client, run: () => string) {
        const tell = (ok: boolean, message: string) => client.send("adminResult", { ok, message });
        const isAdmin = await platform().isAdmin(this.town.guildId, client.auth.id).catch(() => false);
        if (!isAdmin) return tell(false, "只有管理員（有「管理伺服器」權限）能擺遊戲桌");
        try {
            tell(true, run());
        } catch (e) {
            if (!(e instanceof GameError)) throw e;
            tell(false, e.message);
        }
    }

    /** 在管理員站的地方放一張新桌子。 */
    private place(client: Client, payload: unknown) {
        const game = (payload as { game?: unknown } | null)?.game;
        if (!GAME_KINDS.includes(game as GameKind)) throw new GameError("要選一種遊戲");
        const { x, y } = this.spotOf(client);
        const placement = { id: `table-${Date.now().toString(36)}-${randomInt(1000)}`, game: game as GameKind, x, y };
        this.checkSpot(placement);
        this.save([...this.placements(), placement]);
        return `在這裡放了一張${GAME_TITLES[placement.game]}桌`;
    }

    /** 把一張桌子搬到管理員站的地方；坐著的人會先起身。 */
    private move(client: Client, payload: unknown) {
        const target = this.placementOf(payload);
        const moved = { ...target, ...this.spotOf(client) };
        this.checkSpot(moved);
        this.save(this.placements().map((p) => (p.id === moved.id ? moved : p)));
        return `把${GAME_TITLES[moved.game]}桌搬到這裡了`;
    }

    /** 移除一張桌子；坐著的人會先起身。 */
    private remove(payload: unknown) {
        const target = this.placementOf(payload);
        this.save(this.placements().filter((p) => p.id !== target.id));
        return `移除了${GAME_TITLES[target.game]}桌`;
    }

    /** 管理員站的位置（取整數，存起來好看）。 */
    private spotOf(client: Client) {
        const me = this.town.state.characters.get(client.sessionId)!;
        return { x: Math.round(me.position.x), y: Math.round(me.position.y) };
    }

    private placementOf(payload: unknown) {
        const id = (payload as { tableId?: unknown } | null)?.tableId;
        const target = this.placements().find((p) => p.id === id);
        if (!target) throw new GameError("找不到這張桌子");
        return target;
    }

    /** 座位要站得住、不在房間裡，也不能跟別的桌子太近。 */
    private checkSpot(placement: TablePlacement) {
        if (!canPlaceTable(placement.x, placement.y, this.town.layout, this.town.walkable)) {
            throw new GameError("這裡放不下：座位會卡到牆或房間，換到空曠一點的地方");
        }
        const tooClose = this.placements().some((p) => p.id !== placement.id && Math.hypot(p.x - placement.x, p.y - placement.y) < TABLE_SPACING);
        if (tooClose) throw new GameError("離別張桌子太近了");
    }

    private placements() {
        return this.town.townSettings.tables(this.town.guildId) ?? defaultTables(this.town.layout);
    }

    private save(placements: TablePlacement[]) {
        this.town.townSettings.setTables(this.town.guildId, placements);
        this.sync();
    }

    // ── 讓地圖上的桌子跟設定一致 ─────────────────────────────────

    /** 新的桌子建起來；不見的、換了遊戲的、放不下的移除；搬家的更新位置（坐著的人先起身）。 */
    private sync() {
        const wanted = new Map(
            this.placements()
                .filter((p) => canPlaceTable(p.x, p.y, this.town.layout, this.town.walkable))
                .map((p) => [p.id, p]),
        );
        for (const [id, live] of this.tables) {
            const placement = wanted.get(id);
            if (!placement || placement.game !== live.placement.game) this.destroy(id);
            else if (placement.x !== live.placement.x || placement.y !== live.placement.y) {
                for (const sessionId of [...live.seats.keys()]) this.stand(sessionId);
                live.placement = placement;
                Object.assign(this.town.state.tables.get(id)!, { x: placement.x, y: placement.y });
            }
        }
        for (const placement of wanted.values()) if (!this.tables.has(placement.id)) this.create(placement);
    }

    private create(placement: TablePlacement) {
        const live: LiveTable = { placement, game: this.createGame(placement), seats: new Map() };
        this.tables.set(placement.id, live);
        const seats = seatsAround(placement.x, placement.y).map(() => "");
        this.town.state.tables.set(placement.id, new GameTable({ game: placement.game, x: placement.x, y: placement.y, seats, view: "" }));
        this.publish(placement.id);
    }

    /** 每種遊戲對應的類別。加新遊戲就加一行。 */
    private createGame(placement: TablePlacement): TableGame {
        const context = this.contextOf(placement.id);
        switch (placement.game) {
            case "dice": return new DiceDuelGame(context);
            case "blackjack": return new BlackjackGame(context);
            case "liar": return new LiarDiceGame(context);
        }
    }

    private destroy(id: string) {
        const live = this.tables.get(id)!;
        for (const sessionId of [...live.seats.keys()]) this.stand(sessionId);
        live.game.dispose();
        this.tables.delete(id);
        this.town.state.tables.delete(id);
    }

    /** 送出這張桌子的公開畫面，以及每個坐著的人自己的私人畫面。 */
    private publish(tableId: string) {
        const live = this.tables.get(tableId);
        const table = this.town.state.tables.get(tableId);
        if (!live || !table) return;
        table.view = JSON.stringify(live.game.publicView());
        for (const seat of live.seats.values()) {
            this.town.clientOf(seat.sessionId)?.send("tablePrivate", { tableId, data: live.game.privateView(seat) ?? null });
        }
    }

    /** 遊戲能對桌子做的事（TableContext）。 */
    private contextOf(tableId: string): TableContext {
        const { town } = this;
        return {
            seated: () => {
                const live = this.tables.get(tableId);
                const order: string[] = Array.from(town.state.tables.get(tableId)?.seats ?? []);
                return live ? order.filter((id) => live.seats.has(id)).map((id) => live.seats.get(id)!) : [];
            },
            balanceOf: (seat) => town.ledger.balance(seat.owner),
            settle: (entries) => {
                const balances = town.ledger.settle(entries.map(({ seat, bet, payout }) => ({ owner: seat.owner, bet, payout })));
                entries.forEach(({ seat }, i) => town.forEachCharacterOf(seat.owner.userId, (character) => (character.chips = balances[i])));
            },
            tell: (seat, ok, message) => town.clientOf(seat.sessionId)?.send("tableResult", { ok, message }),
            changed: () => this.publish(tableId),
            setTimer: (ms, run) => {
                const delayed = town.clock.setTimeout(run, ms);
                return () => delayed.clear();
            },
            randomInt: (n) => randomInt(n),
        };
    }
}
