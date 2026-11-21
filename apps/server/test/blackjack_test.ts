import assert from "assert";
import {
    BlackjackError, deal, forceStand, freshDeck, handValue, hit, isBlackjack, playDealer, playersDone, settleBlackjack, shuffle, stand,
    type Card,
} from "../src/games/blackjack.js";

const c = (rank: Card["rank"]): Card => ({ rank, suit: "♠" });
/** 照順序發的牌：閒家 1 拿兩張、閒家 2 拿兩張…、莊家兩張，再來是要牌時拿的。 */
const deck = (...ranks: Card["rank"][]) => ranks.map(c);

describe("21 點規則", () => {
    it("J、Q、K 算 10；A 算 11，會爆牌時改算 1", () => {
        assert.deepStrictEqual(handValue([c("K"), c("Q")]), { total: 20, soft: false });
        assert.deepStrictEqual(handValue([c("A"), c("9")]), { total: 20, soft: true });
        assert.deepStrictEqual(handValue([c("A"), c("9"), c("5")]), { total: 15, soft: false });
        assert.deepStrictEqual(handValue([c("A"), c("A"), c("9")]), { total: 21, soft: true });
    });

    it("兩張牌 21 點是黑傑克，三張湊到 21 不是", () => {
        assert.ok(isBlackjack([c("A"), c("K")]));
        assert.ok(!isBlackjack([c("7"), c("7"), c("7")]));
    });

    it("一副牌 52 張不重複；洗牌不會少牌", () => {
        const cards = freshDeck();
        assert.strictEqual(new Set(cards.map((x) => x.rank + x.suit)).size, 52);
        assert.strictEqual(shuffle(cards, (n) => n - 1).length, 52);
    });

    it("要牌爆了就輸；輪流到下一個人", () => {
        let round = deal(["a", "b"], deck("10", "6", "9", "9", "10", "7", "K"));
        round = hit(round, "a"); // 拿到 K：26 爆牌
        assert.strictEqual(round.players[0].done, true);
        assert.strictEqual(round.players[round.turn].id, "b");
        assert.throws(() => hit(round, "a"), BlackjackError);
    });

    it("沒輪到不能動作", () => {
        const round = deal(["a", "b"], deck("10", "6", "9", "9", "10", "7"));
        assert.throws(() => stand(round, "b"), /還沒輪到你/);
    });

    it("莊家不到 17 一定要牌，到 17 就停", () => {
        let round = deal(["a"], deck("10", "8", "10", "6", "5", "3"));
        round = stand(round, "a");
        round = playDealer(round);
        assert.deepStrictEqual(round.dealer.map((x) => x.rank), ["10", "6", "5"]); // 16 要牌 → 21 停
    });

    it("結算：爆牌輸、黑傑克贏 1.5 倍、莊家爆牌閒家贏、比點數、平手不輸不贏", () => {
        const round = {
            deck: [] as Card[],
            dealer: [c("10"), c("8")], // 18
            players: [
                { id: "bust", cards: [c("10"), c("8"), c("5")], done: true },
                { id: "bj", cards: [c("A"), c("K")], done: true },
                { id: "win", cards: [c("10"), c("9")], done: true },
                { id: "lose", cards: [c("10"), c("7")], done: true },
                { id: "push", cards: [c("9"), c("9")], done: true },
            ],
            turn: 5,
        };
        assert.deepStrictEqual(settleBlackjack(round, 50), { bust: -50, bj: 75, win: 50, lose: -50, push: 0 });
        const dealerBust = { ...round, dealer: [c("10"), c("6"), c("K")] };
        assert.strictEqual(settleBlackjack(dealerBust, 50).lose, 50);
    });

    it("莊家黑傑克時，閒家沒有黑傑克就輸、也有黑傑克就平手", () => {
        const round = {
            deck: [] as Card[], dealer: [c("A"), c("Q")], turn: 2,
            players: [{ id: "a", cards: [c("10"), c("10")], done: true }, { id: "b", cards: [c("A"), c("J")], done: true }],
        };
        assert.deepStrictEqual(settleBlackjack(round, 50), { a: -50, b: 0 });
    });

    it("逾時或離桌時強制停牌，輪到下一個人", () => {
        let round = deal(["a", "b"], deck("10", "6", "9", "9", "10", "7"));
        round = forceStand(round, "a");
        assert.strictEqual(round.players[round.turn].id, "b");
        round = forceStand(round, "b");
        assert.ok(playersDone(round));
    });

    it("拿到黑傑克的人一開局就結束", () => {
        const round = deal(["a", "b"], deck("A", "K", "9", "9", "10", "7"));
        assert.strictEqual(round.players[round.turn].id, "b");
    });
});
