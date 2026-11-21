import type { Client } from "colyseus";
import { randomInt } from "node:crypto";
import { DICE_STAKE, DiceError, emptyRound, joinRound, leaveRound, settleRound, type DiceRound } from "../../games/diceDuel.js";
import { GameTable } from "../schema/TownState.js";
import { memberOf } from "../Town.js";
import { TownFeature, type MessageHandler } from "./TownFeature.js";

/** 離遊戲桌中心多近才能入座（像素）。 */
const SIT_RANGE = 40;

/**
 * 遊戲桌：走到桌旁入座，玩骰子比大小（規則在 games/diceDuel）。
 * 骰子由伺服器擲，結算一次記進籌碼帳本；擲骰前起身或斷線就退出這一局，不扣籌碼。
 */
export class GameTables extends TownFeature {
    /** 每張遊戲桌這一局的下注狀況，key 是桌子 ID。 */
    private rounds = new Map<string, DiceRound>();

    messages(): Record<string, MessageHandler> {
        return {
            sit: (client) => this.sit(client),
            stand: (client) => this.stand(client.sessionId),
            bet: (client) => this.bet(client),
            roll: (client) => this.roll(client),
        };
    }

    /** 斷線視為起身：還沒擲骰的這一局不算、不扣籌碼。 */
    onLeave(client: Client) {
        this.stand(client.sessionId);
    }

    /** 地圖上新出現的桌子，建立它的狀態。 */
    async onLayoutChanged() {
        for (const spot of this.town.layout.tables) {
            if (!this.town.state.tables.has(spot.id)) {
                this.town.state.tables.set(spot.id, new GameTable({ seats: spot.seats.map(() => ""), bettors: [], result: "" }));
            }
        }
    }

    /** 走到遊戲桌旁入座：站到空的座位上，坐著時不能走動。 */
    private sit(client: Client) {
        const { state, layout } = this.town;
        const me = state.characters.get(client.sessionId);
        if (!me) return;
        const say = (ok: boolean, message: string) => client.send("tableResult", { ok, message });
        if (me.seatedAt) return say(false, "已經坐在遊戲桌了");
        let seatedElsewhere = false;
        this.town.forEachCharacterOf(client.auth.id, (character) => (seatedElsewhere ||= character !== me && !!character.seatedAt));
        if (seatedElsewhere) return say(false, "你已經在另一個分頁入座了");

        const spot = layout.tables.find((t) => Math.hypot(t.x - me.position.x, t.y - me.position.y) <= SIT_RANGE);
        if (!spot) return say(false, "旁邊沒有遊戲桌");
        const table = state.tables.get(spot.id)!;
        const seat = table.seats.indexOf("");
        if (seat === -1) return say(false, "這桌坐滿了");

        table.seats[seat] = client.sessionId;
        me.seatedAt = spot.id;
        me.position.x = spot.seats[seat].x;
        me.position.y = spot.seats[seat].y;
        this.town.placeIn(client.sessionId, undefined, "other");
        // 入座前前端送出、還在路上的移動不能把人拉離座位
        this.town.holdStill(client.sessionId);
        say(true, `入座了：骰子比大小，每局 ${DICE_STAKE} 籌碼`);
    }

    /** 起身（按離開或斷線）：讓出座位，這一局還沒擲骰就退出，不扣籌碼。 */
    private stand(sessionId: string) {
        const me = this.town.state.characters.get(sessionId);
        const tableId = me?.seatedAt;
        if (!me || !tableId) return;
        const table = this.town.state.tables.get(tableId)!;
        const seat = table.seats.indexOf(sessionId);
        if (seat !== -1) table.seats[seat] = "";
        me.seatedAt = "";
        this.setRound(tableId, leaveRound(this.round(tableId), sessionId));
        // 起身後從座位重新累積移動額度
        this.town.holdStill(sessionId);
    }

    /** 下注加入這一局；籌碼在擲骰時才扣。 */
    private bet(client: Client) {
        const tableId = this.town.state.characters.get(client.sessionId)?.seatedAt;
        const say = (ok: boolean, message: string) => client.send("tableResult", { ok, message });
        if (!tableId) return say(false, "先入座才能下注");
        try {
            this.setRound(tableId, joinRound(this.round(tableId), client.sessionId, this.town.ledger.balance(memberOf(client))));
            say(true, `下注 ${DICE_STAKE} 籌碼，等其他人下注後按擲骰`);
        } catch (e) {
            if (!(e instanceof DiceError)) throw e;
            say(false, e.message);
        }
    }

    /** 擲骰：伺服器替每位下注的人擲兩顆骰子，結算後立刻記進籌碼帳本。 */
    private roll(client: Client) {
        const { state, ledger } = this.town;
        const tableId = state.characters.get(client.sessionId)?.seatedAt;
        const say = (ok: boolean, message: string) => client.send("tableResult", { ok, message });
        if (!tableId) return say(false, "先入座才能擲骰");
        const round = this.round(tableId);
        if (!round.players.includes(client.sessionId)) return say(false, "先下注才能擲骰");

        // 一局裡的人都還連著（斷線會先起身退出），所以一定找得到
        const ownerOf = (sessionId: string) => memberOf(this.town.clientOf(sessionId)!);
        // 下注之後籌碼可能在別處用掉了：擲骰前再確認一次，不夠的人退出這一局
        const ready = { players: round.players.filter((p) => ledger.balance(ownerOf(p)) >= DICE_STAKE) };
        for (const p of round.players.filter((p) => !ready.players.includes(p))) {
            this.town.clientOf(p)?.send("tableResult", { ok: false, message: `籌碼不夠 ${DICE_STAKE}，退出這一局` });
        }
        if (!ready.players.includes(client.sessionId)) return this.setRound(tableId, ready);
        let result;
        try {
            result = settleRound(ready, Object.fromEntries(ready.players.map((p) => [p, [randomInt(1, 7), randomInt(1, 7)]])));
        } catch (e) {
            if (!(e instanceof DiceError)) throw e;
            this.setRound(tableId, ready);
            return say(false, e.message);
        }

        const entries = Object.entries(result.deltas).map(([sessionId, delta]) => ({
            owner: ownerOf(sessionId),
            bet: DICE_STAKE,
            payout: delta + DICE_STAKE,
        }));
        const balances = ledger.settle(entries);
        entries.forEach(({ owner }, i) => this.town.forEachCharacterOf(owner.userId, (character) => (character.chips = balances[i])));
        state.tables.get(tableId)!.result = JSON.stringify(
            Object.entries(result.rolls).map(([sessionId, dice]) => ({
                name: state.characters.get(sessionId)?.name ?? "",
                dice,
                delta: result.deltas[sessionId],
            })),
        );
        this.setRound(tableId, emptyRound());
    }

    private round(tableId: string) {
        return this.rounds.get(tableId) ?? emptyRound();
    }

    /** 改這一局的下注狀況，同步給前端顯示誰下注了。 */
    private setRound(tableId: string, round: DiceRound) {
        this.rounds.set(tableId, round);
        const bettors = this.town.state.tables.get(tableId)!.bettors;
        bettors.splice(0, bettors.length, ...round.players);
    }
}
