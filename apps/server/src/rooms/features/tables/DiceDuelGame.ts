import { DICE_STAKE, DiceError, emptyRound, joinRound, leaveRound, settleRound, type DiceRound } from "../../../games/diceDuel.js";
import { GameError, TableGame, type GameAction, type TableSeat } from "./TableGame.js";

type ResultRow = { name: string; dice: [number, number]; delta: number };

/** 骰子比大小（規則在 games/diceDuel）：下注後任何一位下注的人按擲骰。擲骰前離開就退出這一局，不扣籌碼。 */
export class DiceDuelGame extends TableGame {
    readonly kind = "dice";
    private round: DiceRound = emptyRound();
    private bettors = new Map<string, TableSeat>();
    private result: ResultRow[] = [];

    actions(): Record<string, GameAction> {
        return { bet: (seat) => this.bet(seat), roll: (seat) => this.roll(seat) };
    }

    publicView() {
        return { stake: DICE_STAKE, bettors: this.round.players, result: this.result };
    }

    onSeatLeft(seat: TableSeat) {
        this.setRound(leaveRound(this.round, seat.sessionId));
    }

    /** 下注加入這一局；籌碼在擲骰時才扣。 */
    private bet(seat: TableSeat) {
        this.setRound(this.rules(() => joinRound(this.round, seat.sessionId, this.table.balanceOf(seat))));
        this.bettors.set(seat.sessionId, seat);
        this.table.tell(seat, true, `下注 ${DICE_STAKE} 籌碼，等其他人下注後按擲骰`);
    }

    /** 擲骰：替每位下注的人擲兩顆骰子，結算後立刻記進籌碼帳本。 */
    private roll(seat: TableSeat) {
        if (!this.round.players.includes(seat.sessionId)) throw new GameError("先下注才能擲骰");
        const seatOf = (id: string) => this.bettors.get(id)!;
        // 下注之後籌碼可能在別處用掉了：擲骰前再確認一次，不夠的人退出這一局
        const ready = { players: this.round.players.filter((p) => this.table.balanceOf(seatOf(p)) >= DICE_STAKE) };
        for (const p of this.round.players.filter((p) => !ready.players.includes(p))) {
            this.table.tell(seatOf(p), false, `籌碼不夠 ${DICE_STAKE}，退出這一局`);
        }
        this.setRound(ready);
        if (!ready.players.includes(seat.sessionId)) return;

        const rolls = Object.fromEntries(ready.players.map((p) => [p, [this.die(), this.die()] as [number, number]]));
        const result = this.rules(() => settleRound(ready, rolls));
        this.table.settle(ready.players.map((p) => ({ seat: seatOf(p), bet: DICE_STAKE, payout: result.deltas[p] + DICE_STAKE })));
        this.result = ready.players.map((p) => ({ name: seatOf(p).name, dice: rolls[p], delta: result.deltas[p] }));
        this.setRound(emptyRound());
    }

    private die = () => this.table.randomInt(6) + 1;

    private setRound(round: DiceRound) {
        this.round = round;
        for (const id of this.bettors.keys()) if (!round.players.includes(id)) this.bettors.delete(id);
        this.table.changed();
    }

    /** 規則模組的錯誤轉成給成員看的 GameError。 */
    private rules<T>(run: () => T): T {
        try {
            return run();
        } catch (e) {
            if (e instanceof DiceError) throw new GameError(e.message);
            throw e;
        }
    }
}
