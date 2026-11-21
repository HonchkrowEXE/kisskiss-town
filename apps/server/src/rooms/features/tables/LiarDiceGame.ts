import {
    LIAR_STAKE, LiarError, challenge, currentPlayer, forfeit, placeBid, settleLiar, startLiar, type LiarOutcome, type LiarRound,
} from "../../../games/liarDice.js";
import { GameError, TableGame, type GameAction, type TableSeat } from "./TableGame.js";

/** 輪到的人多久沒動作就算輸（毫秒）。測試可以改短。 */
export let LIAR_TURN_MS = 30_000;
export const setLiarTurnMs = (ms: number) => (LIAR_TURN_MS = ms);

const REASONS: Record<LiarOutcome["reason"], string> = {
    "challenge-failed": "抓錯了",
    caught: "吹牛被抓到",
    forfeit: "逾時或離開",
};

/**
 * 吹牛（規則在 games/liarDice）：加入 → 任何一位加入的人按開局 → 輪流喊或抓 → 輸的人付給其他人。
 * 每個人只看得到自己的骰子（私下送），開盅後才公開全部。
 * 開局前離開：退出。開局後離開或逾時：算輸。
 */
export class LiarDiceGame extends TableGame {
    readonly kind = "liar";
    private joined: TableSeat[] = [];
    private round?: LiarRound;
    private seats = new Map<string, TableSeat>();
    private result?: { loser: string; reason: string; bid?: { by: string; count: number; face: number }; actual?: number; dice: Record<string, number[]> };
    private cancelTimer = () => {};

    actions(): Record<string, GameAction> {
        return {
            join: (seat) => this.join(seat),
            start: (seat) => this.start(seat),
            bid: (seat, payload) => this.bid(seat, payload.count, payload.face),
            challenge: (seat) => this.challenge(seat),
        };
    }

    publicView() {
        const round = this.round;
        const name = (id: string) => this.seats.get(id)?.name ?? "";
        return {
            stake: LIAR_STAKE,
            phase: round ? "playing" : "waiting",
            joined: this.joined.map((s) => s.sessionId),
            players: round?.players.map((id) => ({ sessionId: id, name: name(id), dice: round.dice[id].length })) ?? [],
            turn: round ? currentPlayer(round) : undefined,
            bid: round?.bid && { name: name(round.bid.by), count: round.bid.count, face: round.bid.face },
            result: this.result,
        };
    }

    /** 自己的骰子，只送給自己。 */
    privateView(seat: TableSeat) {
        return this.round?.dice[seat.sessionId];
    }

    onSeatLeft(seat: TableSeat) {
        if (this.round?.players.includes(seat.sessionId)) return this.finish(forfeit(seat.sessionId));
        this.joined = this.joined.filter((s) => s.sessionId !== seat.sessionId);
        this.table.changed();
    }

    dispose() {
        this.cancelTimer();
    }

    private join(seat: TableSeat) {
        if (this.round) throw new GameError("這一局已經開始了，等下一局");
        if (this.joined.some((s) => s.sessionId === seat.sessionId)) throw new GameError("已經加入了");
        if (this.table.balanceOf(seat) < LIAR_STAKE) throw new GameError(`籌碼不夠，每局要 ${LIAR_STAKE}`);
        this.joined.push(seat);
        this.table.tell(seat, true, `加入了，每局 ${LIAR_STAKE} 籌碼，兩人以上就能開局`);
        this.table.changed();
    }

    private start(seat: TableSeat) {
        if (this.round) throw new GameError("這一局已經開始了");
        if (!this.joined.some((s) => s.sessionId === seat.sessionId)) throw new GameError("先加入才能開局");
        for (const s of this.joined.filter((s) => this.table.balanceOf(s) < LIAR_STAKE)) {
            this.table.tell(s, false, `籌碼不夠 ${LIAR_STAKE}，退出這一局`);
        }
        this.joined = this.joined.filter((s) => this.table.balanceOf(s) >= LIAR_STAKE);
        const players = this.joined.map((s) => s.sessionId);
        const round = this.rules(() => startLiar(players, () => this.table.randomInt(6) + 1));
        this.seats = new Map(this.joined.map((s) => [s.sessionId, s]));
        this.result = undefined;
        this.setRound(round);
    }

    private bid(seat: TableSeat, count: unknown, face: unknown) {
        const round = this.mustPlay();
        this.setRound(this.rules(() => placeBid(round, seat.sessionId, count, face)));
    }

    private challenge(seat: TableSeat) {
        const round = this.mustPlay();
        this.finish(this.rules(() => challenge(round, seat.sessionId)));
    }

    /** 換成新的狀態，幫輪到的人計時；逾時算輸。 */
    private setRound(round: LiarRound) {
        this.cancelTimer();
        this.round = round;
        const turn = currentPlayer(round);
        this.cancelTimer = this.table.setTimer(LIAR_TURN_MS, () => this.round && this.finish(forfeit(turn)));
        this.table.changed();
    }

    /** 一局結束：結算、開盅（公開全部骰子）。 */
    private finish(outcome: LiarOutcome) {
        this.cancelTimer();
        const round = this.round!;
        const deltas = settleLiar(round.players, outcome.loser);
        this.table.settle(round.players.map((id) => ({ seat: this.seats.get(id)!, bet: LIAR_STAKE, payout: deltas[id] + LIAR_STAKE })));
        const name = (id: string) => this.seats.get(id)!.name;
        this.result = {
            loser: name(outcome.loser),
            reason: REASONS[outcome.reason],
            bid: round.bid && { by: name(round.bid.by), count: round.bid.count, face: round.bid.face },
            actual: outcome.actual,
            dice: Object.fromEntries(round.players.map((id) => [name(id), round.dice[id]])),
        };
        this.round = undefined;
        this.joined = [];
        this.table.changed();
    }

    private mustPlay() {
        if (!this.round) throw new GameError("還沒開局");
        return this.round;
    }

    private rules<T>(run: () => T): T {
        try {
            return run();
        } catch (e) {
            if (e instanceof LiarError) throw new GameError(e.message);
            throw e;
        }
    }
}
