// 21 點的規則（名詞表：遊戲桌）。純邏輯：輸入這一局的狀態和動作，輸出新狀態；不碰網路、畫面、籌碼帳本。
//
// 規則：每人押一樣的籌碼跟莊家（小鎮）對賭。每人先拿兩張牌，莊家兩張（一張蓋著）。
// 輪到的人可以要牌或停牌，超過 21 點爆牌就輸。大家都停了，莊家翻牌，點數不到 17 一定要牌，到 17 就停。
// 結算：爆牌輸；兩張牌就 21 點（黑傑克）贏 1.5 倍；莊家爆牌閒家贏；比點數，大的贏，一樣大不輸不贏。

/** 每局每人押多少籌碼。 */
export const BLACKJACK_STAKE = 50;

/** 莊家點數不到這個數字就一定要牌。 */
const DEALER_STANDS_AT = 17;

export const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;
export const SUITS = ["♠", "♥", "♦", "♣"] as const;
export type Card = { rank: (typeof RANKS)[number]; suit: (typeof SUITS)[number] };

export type BlackjackPlayer = { id: string; cards: Card[]; done: boolean };

/** 一局進行中的狀態。turn 是輪到的閒家（players 的索引）；等於 players.length 代表閒家都結束了。 */
export type BlackjackRound = { deck: Card[]; dealer: Card[]; players: BlackjackPlayer[]; turn: number };

/** 規則不允許的動作。訊息可以直接顯示給成員看。 */
export class BlackjackError extends Error {}

/** 一副 52 張、照順序排的牌。 */
export function freshDeck(): Card[] {
    return SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })));
}

/** 洗牌（Fisher–Yates）。randomInt(n) 回傳 0～n-1 的整數；伺服器用 crypto 的亂數。 */
export function shuffle(deck: Card[], randomInt: (n: number) => number): Card[] {
    const cards = [...deck];
    for (let i = cards.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    return cards;
}

/** 手牌點數：J、Q、K 算 10；A 算 11，會爆牌時改算 1。soft 表示有 A 正算成 11。 */
export function handValue(cards: Card[]): { total: number; soft: boolean } {
    let total = 0;
    let aces = 0;
    for (const { rank } of cards) {
        if (rank === "A") aces++;
        total += rank === "A" ? 11 : ["J", "Q", "K"].includes(rank) ? 10 : Number(rank);
    }
    while (total > 21 && aces > 0) {
        total -= 10;
        aces--;
    }
    return { total, soft: aces > 0 };
}

/** 兩張牌就 21 點。 */
export const isBlackjack = (cards: Card[]) => cards.length === 2 && handValue(cards).total === 21;

/** 發牌開局：每人兩張、莊家兩張。拿到黑傑克的人直接結束。deck 要先洗好。 */
export function deal(playerIds: string[], deck: Card[]): BlackjackRound {
    if (playerIds.length < 1) throw new BlackjackError("至少要一個人下注才能發牌");
    const cards = [...deck];
    const draw = () => {
        const card = cards.shift();
        if (!card) throw new Error("牌發完了");
        return card;
    };
    const players = playerIds.map((id) => ({ id, cards: [draw(), draw()], done: false }));
    const dealer = [draw(), draw()];
    for (const p of players) p.done = isBlackjack(p.cards);
    return advance({ deck: cards, dealer, players, turn: 0 });
}

/** 要牌。爆牌或剛好 21 點就自動結束。 */
export function hit(round: BlackjackRound, playerId: string): BlackjackRound {
    const next = mustBeTurn(round, playerId);
    const player = next.players[next.turn];
    const card = next.deck.shift();
    if (!card) throw new Error("牌發完了");
    player.cards.push(card);
    if (handValue(player.cards).total >= 21) player.done = true;
    return advance(next);
}

/** 停牌。 */
export function stand(round: BlackjackRound, playerId: string): BlackjackRound {
    const next = mustBeTurn(round, playerId);
    next.players[next.turn].done = true;
    return advance(next);
}

/** 不管有沒有輪到，讓這個人停牌（逾時或離桌）。 */
export function forceStand(round: BlackjackRound, playerId: string): BlackjackRound {
    const next = clone(round);
    const player = next.players.find((p) => p.id === playerId);
    if (player) player.done = true;
    return advance(next);
}

/** 閒家都結束了沒（輪到莊家）。 */
export const playersDone = (round: BlackjackRound) => round.turn >= round.players.length;

/** 莊家翻牌、照規則要牌到 17 點以上。閒家都結束了才能呼叫。 */
export function playDealer(round: BlackjackRound): BlackjackRound {
    if (!playersDone(round)) throw new Error("還有閒家沒結束");
    const next = clone(round);
    // 閒家全爆牌的話莊家不用再要牌
    const anyAlive = next.players.some((p) => handValue(p.cards).total <= 21);
    while (anyAlive && handValue(next.dealer).total < DEALER_STANDS_AT) {
        const card = next.deck.shift();
        if (!card) throw new Error("牌發完了");
        next.dealer.push(card);
    }
    return next;
}

/** 結算每位閒家的輸贏（正數是贏）。莊家要先 playDealer。 */
export function settleBlackjack(round: BlackjackRound, stake = BLACKJACK_STAKE): Record<string, number> {
    const dealer = handValue(round.dealer).total;
    const dealerBlackjack = isBlackjack(round.dealer);
    const deltas: Record<string, number> = {};
    for (const p of round.players) {
        const total = handValue(p.cards).total;
        const blackjack = isBlackjack(p.cards);
        if (total > 21) deltas[p.id] = -stake;
        else if (blackjack && dealerBlackjack) deltas[p.id] = 0;
        else if (blackjack) deltas[p.id] = Math.floor(stake * 1.5);
        else if (dealerBlackjack) deltas[p.id] = -stake;
        else if (dealer > 21 || total > dealer) deltas[p.id] = stake;
        else if (total < dealer) deltas[p.id] = -stake;
        else deltas[p.id] = 0;
    }
    return deltas;
}

function mustBeTurn(round: BlackjackRound, playerId: string) {
    if (round.players[round.turn]?.id !== playerId) throw new BlackjackError("還沒輪到你");
    return clone(round);
}

/** 輪到下一個還沒結束的閒家。 */
function advance(round: BlackjackRound): BlackjackRound {
    while (round.turn < round.players.length && round.players[round.turn].done) round.turn++;
    return round;
}

const clone = (round: BlackjackRound): BlackjackRound => structuredClone(round);
