// 骰子比大小的規則（名詞表：遊戲桌）。純邏輯：輸入這一局的狀態和動作，輸出新狀態；不碰網路、畫面、籌碼帳本。
//
// 規則：每局每人押一樣的籌碼（stake）。至少兩人下注後，任何一位下注的人按擲骰，
// 每人擲兩顆骰子，點數和最大的人拿走整個彩池；同點平分，除不盡的零頭依下注順序每人多拿 1。

/** 每局每人押多少籌碼。 */
export const DICE_STAKE = 50;

/** 這一局已經下注的人（照下注順序），還沒擲骰。 */
export type DiceRound = { players: string[] };

export type DiceRoll = [number, number];

/** 擲骰結果：每人的點數、贏家、每人籌碼的增減（加起來一定是 0）。 */
export type DiceResult = { rolls: Record<string, DiceRoll>; winners: string[]; deltas: Record<string, number> };

/** 規則不允許的動作。訊息可以直接顯示給成員看。 */
export class DiceError extends Error {}

export const emptyRound = (): DiceRound => ({ players: [] });

/** 下注加入這一局；籌碼不夠或已經下注過就拒絕。 */
export function joinRound(round: DiceRound, player: string, balance: number, stake = DICE_STAKE): DiceRound {
    if (round.players.includes(player)) throw new DiceError("這一局已經下注了");
    if (balance < stake) throw new DiceError(`籌碼不夠，每局要 ${stake}`);
    return { players: [...round.players, player] };
}

/** 擲骰前離開（起身或斷線）：退出這一局，不扣籌碼。 */
export function leaveRound(round: DiceRound, player: string): DiceRound {
    return { players: round.players.filter((p) => p !== player) };
}

/** 擲骰結算。rolls 由呼叫的人產生（伺服器擲），每位下注的人都要有。 */
export function settleRound(round: DiceRound, rolls: Record<string, DiceRoll>, stake = DICE_STAKE): DiceResult {
    const { players } = round;
    if (players.length < 2) throw new DiceError("至少要兩個人下注才能擲骰");
    for (const p of players) {
        const roll = rolls[p];
        if (!roll || !roll.every((d) => Number.isInteger(d) && d >= 1 && d <= 6)) throw new Error(`${p} 沒有合法的點數`);
    }
    const total = (p: string) => rolls[p][0] + rolls[p][1];
    const best = Math.max(...players.map(total));
    const winners = players.filter((p) => total(p) === best);

    const pot = stake * players.length;
    const share = Math.floor(pot / winners.length);
    const remainder = pot - share * winners.length;
    const deltas: Record<string, number> = {};
    for (const p of players) deltas[p] = -stake;
    winners.forEach((w, i) => (deltas[w] += share + (i < remainder ? 1 : 0)));

    return { rolls: Object.fromEntries(players.map((p) => [p, rolls[p]])), winners, deltas };
}
