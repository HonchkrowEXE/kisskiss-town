import {
    BLACKJACK_STAKE, BlackjackError, deal, forceStand, freshDeck, handValue, hit, playDealer, playersDone, settleBlackjack, shuffle, stand,
    type BlackjackRound, type Card,
} from "../../../games/blackjack.js";
import { GameError, TableGame, type GameAction, type TableSeat } from "./TableGame.js";

/** 輪到的人多久沒動作就自動停牌（毫秒）。測試可以改短。 */
export let BLACKJACK_TURN_MS = 30_000;
export const setBlackjackTurnMs = (ms: number) => (BLACKJACK_TURN_MS = ms);

type ResultRow = { name: string; cards: Card[]; total: number; delta: number };

/**
 * 21 點（規則在 games/blackjack）：跟莊家（小鎮）對賭。
 * 下注 → 任何一位下注的人按發牌 → 輪流要牌或停牌 → 莊家翻牌 → 結算。
 * 前端只看得到莊家的第一張牌，牌堆永遠不送出去。
 * 發牌前離開：退出、不扣籌碼。發牌後離開或逾時：算停牌，照樣結算（押的籌碼已經在桌上）。
 */
export class BlackjackGame extends TableGame {
    readonly kind = "blackjack";
    private bettors: TableSeat[] = [];
    private round?: BlackjackRound;
    private seats = new Map<string, TableSeat>();
    private dealerResult: Card[] = [];
    private result: ResultRow[] = [];
    private cancelTimer = () => {};

    actions(): Record<string, GameAction> {
        return {
            bet: (seat) => this.bet(seat),
            deal: (seat) => this.deal(seat),
            hit: (seat) => this.play(seat, hit),
            stand: (seat) => this.play(seat, stand),
        };
    }

    publicView() {
        const round = this.round;
        return {
            stake: BLACKJACK_STAKE,
            phase: round ? "playing" : "betting",
            bettors: this.bettors.map((s) => s.sessionId),
            // 進行中只給莊家的第一張牌；另一張蓋著
            dealer: round ? [round.dealer[0]] : this.dealerResult,
            dealerTotal: round ? undefined : this.dealerResult.length ? handValue(this.dealerResult).total : undefined,
            players: round?.players.map((p) => ({ name: this.seats.get(p.id)!.name, sessionId: p.id, cards: p.cards, total: handValue(p.cards).total, done: p.done })) ?? [],
            turn: round && !playersDone(round) ? round.players[round.turn].id : undefined,
            result: this.result,
        };
    }

    onSeatLeft(seat: TableSeat) {
        if (!this.round) {
            this.bettors = this.bettors.filter((s) => s.sessionId !== seat.sessionId);
            return this.table.changed();
        }
        this.update(forceStand(this.round, seat.sessionId));
    }

    dispose() {
        this.cancelTimer();
    }

    private bet(seat: TableSeat) {
        if (this.round) throw new GameError("這一局已經開始了，等下一局");
        if (this.bettors.some((s) => s.sessionId === seat.sessionId)) throw new GameError("這一局已經下注了");
        if (this.table.balanceOf(seat) < BLACKJACK_STAKE) throw new GameError(`籌碼不夠，每局要 ${BLACKJACK_STAKE}`);
        this.bettors.push(seat);
        this.table.tell(seat, true, `下注 ${BLACKJACK_STAKE} 籌碼，大家下注後按發牌`);
        this.table.changed();
    }

    private deal(seat: TableSeat) {
        if (this.round) throw new GameError("這一局已經開始了");
        if (!this.bettors.some((s) => s.sessionId === seat.sessionId)) throw new GameError("先下注才能發牌");
        // 下注之後籌碼可能在別處用掉了：發牌前再確認一次，不夠的人退出這一局
        for (const s of this.bettors.filter((s) => this.table.balanceOf(s) < BLACKJACK_STAKE)) {
            this.table.tell(s, false, `籌碼不夠 ${BLACKJACK_STAKE}，退出這一局`);
        }
        this.bettors = this.bettors.filter((s) => this.table.balanceOf(s) >= BLACKJACK_STAKE);
        if (!this.bettors.some((s) => s.sessionId === seat.sessionId)) return this.table.changed();

        this.seats = new Map(this.bettors.map((s) => [s.sessionId, s]));
        const deck = shuffle(freshDeck(), (n) => this.table.randomInt(n));
        this.update(this.rules(() => deal(this.bettors.map((s) => s.sessionId), deck)));
    }

    private play(seat: TableSeat, action: (round: BlackjackRound, id: string) => BlackjackRound) {
        if (!this.round) throw new GameError("還沒發牌");
        const round = this.round;
        this.update(this.rules(() => action(round, seat.sessionId)));
    }

    /** 換成新的狀態；閒家都結束了就讓莊家翻牌並結算，不然幫輪到的人計時。 */
    private update(round: BlackjackRound) {
        this.cancelTimer();
        if (!playersDone(round)) {
            this.round = round;
            const turn = round.players[round.turn].id;
            this.cancelTimer = this.table.setTimer(BLACKJACK_TURN_MS, () => this.round && this.update(forceStand(this.round, turn)));
            return this.table.changed();
        }
        const finished = playDealer(round);
        const deltas = settleBlackjack(finished);
        this.table.settle(finished.players.map((p) => ({ seat: this.seats.get(p.id)!, bet: BLACKJACK_STAKE, payout: deltas[p.id] + BLACKJACK_STAKE })));
        this.dealerResult = finished.dealer;
        this.result = finished.players.map((p) => ({ name: this.seats.get(p.id)!.name, cards: p.cards, total: handValue(p.cards).total, delta: deltas[p.id] }));
        this.round = undefined;
        this.bettors = [];
        this.table.changed();
    }

    private rules<T>(run: () => T): T {
        try {
            return run();
        } catch (e) {
            if (e instanceof BlackjackError) throw new GameError(e.message);
            throw e;
        }
    }
}
