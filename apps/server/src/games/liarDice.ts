// 吹牛（骰子版）的規則（名詞表：遊戲桌）。純邏輯：輸入這一局的狀態和動作，輸出新狀態；不碰網路、畫面、籌碼帳本。
//
// 規則：每人押一樣的籌碼，各擲 5 顆骰子藏起來。輪到的人喊「全桌至少有幾顆幾點」，
// 下一個人要喊得更大（顆數更多，或顆數一樣但點數更大），或是「抓」上一個人吹牛。
// 抓的時候開盅數全桌：真的有那麼多顆，抓的人輸；不夠，喊的人輸。1 點不當萬用。
// 輸的人輸掉押的籌碼，由其他人平分；逾時沒動作或中途離開的人算輸。

/** 每局每人押多少籌碼。 */
export const LIAR_STAKE = 50;

/** 每人幾顆骰子。 */
export const DICE_PER_PLAYER = 5;

export type Bid = { by: string; count: number; face: number };

/** 一局進行中的狀態。turn 是輪到的人（players 的索引）。 */
export type LiarRound = { players: string[]; dice: Record<string, number[]>; turn: number; bid?: Bid };

/** 一局的結果：誰輸、原因、開盅時全桌有幾顆（抓的時候才有）。 */
export type LiarOutcome = { loser: string; reason: "challenge-failed" | "caught" | "forfeit"; actual?: number };

/** 規則不允許的動作。訊息可以直接顯示給成員看。 */
export class LiarError extends Error {}

/** 開局：每人擲 5 顆。rollDie 回傳 1～6；伺服器用 crypto 的亂數。 */
export function startLiar(players: string[], rollDie: () => number): LiarRound {
    if (players.length < 2) throw new LiarError("至少要兩個人才能開局");
    const dice = Object.fromEntries(players.map((p) => [p, Array.from({ length: DICE_PER_PLAYER }, rollDie)]));
    return { players: [...players], dice, turn: 0 };
}

/** 新的喊價有沒有比上一手大：顆數更多，或顆數一樣但點數更大。 */
export const isHigher = (bid: { count: number; face: number }, previous: { count: number; face: number } | undefined) =>
    !previous || bid.count > previous.count || (bid.count === previous.count && bid.face > previous.face);

/** 喊價：輪到的人喊「至少 count 顆 face 點」。 */
export function placeBid(round: LiarRound, playerId: string, count: unknown, face: unknown): LiarRound {
    mustBeTurn(round, playerId);
    const total = round.players.length * DICE_PER_PLAYER;
    if (!Number.isInteger(count) || (count as number) < 1 || (count as number) > total) throw new LiarError(`顆數要是 1～${total}`);
    if (!Number.isInteger(face) || (face as number) < 1 || (face as number) > 6) throw new LiarError("點數要是 1～6");
    const bid = { by: playerId, count: count as number, face: face as number };
    if (!isHigher(bid, round.bid)) throw new LiarError("要喊得比上一手大：顆數更多，或顆數一樣但點數更大");
    return { ...round, bid, turn: (round.turn + 1) % round.players.length };
}

/** 抓上一個人吹牛：開盅數全桌有幾顆那個點數。 */
export function challenge(round: LiarRound, playerId: string): LiarOutcome {
    mustBeTurn(round, playerId);
    if (!round.bid) throw new LiarError("還沒有人喊，不能抓");
    const actual = Object.values(round.dice).flat().filter((d) => d === round.bid!.face).length;
    return actual >= round.bid.count
        ? { loser: playerId, reason: "challenge-failed", actual }
        : { loser: round.bid.by, reason: "caught", actual };
}

/** 逾時或離開：這個人算輸。 */
export const forfeit = (playerId: string): LiarOutcome => ({ loser: playerId, reason: "forfeit" });

/** 輸的人輸掉押的籌碼，其他人平分；除不盡的零頭依座位順序每人多 1。加起來一定是 0。 */
export function settleLiar(players: string[], loser: string, stake = LIAR_STAKE): Record<string, number> {
    const winners = players.filter((p) => p !== loser);
    const share = Math.floor(stake / winners.length);
    const remainder = stake - share * winners.length;
    const deltas: Record<string, number> = { [loser]: -stake };
    winners.forEach((w, i) => (deltas[w] = share + (i < remainder ? 1 : 0)));
    return deltas;
}

/** 現在輪到誰。 */
export const currentPlayer = (round: LiarRound) => round.players[round.turn];

function mustBeTurn(round: LiarRound, playerId: string) {
    if (currentPlayer(round) !== playerId) throw new LiarError("還沒輪到你");
}
