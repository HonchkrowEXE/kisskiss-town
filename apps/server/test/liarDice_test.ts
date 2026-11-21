import assert from "assert";
import { LiarError, challenge, currentPlayer, forfeit, isHigher, placeBid, settleLiar, startLiar, type LiarRound } from "../src/games/liarDice.js";

const sum = (deltas: Record<string, number>) => Object.values(deltas).reduce((a, b) => a + b, 0);
/** 指定每個人的骰子。 */
const round = (dice: Record<string, number[]>): LiarRound => ({ players: Object.keys(dice), dice, turn: 0 });

describe("吹牛規則", () => {
    it("每人擲 5 顆；不到兩人不能開局", () => {
        const r = startLiar(["a", "b", "c"], () => 3);
        assert.deepStrictEqual(r.dice.a, [3, 3, 3, 3, 3]);
        assert.throws(() => startLiar(["a"], () => 3), LiarError);
    });

    it("喊價要比上一手大：顆數更多，或顆數一樣點數更大", () => {
        assert.ok(isHigher({ count: 3, face: 2 }, { count: 2, face: 6 }));
        assert.ok(isHigher({ count: 2, face: 5 }, { count: 2, face: 4 }));
        assert.ok(!isHigher({ count: 2, face: 4 }, { count: 2, face: 4 }));
        assert.ok(!isHigher({ count: 1, face: 6 }, { count: 2, face: 1 }));
    });

    it("輪流喊；喊得不夠大、沒輪到、數字不合法都被拒", () => {
        let r = round({ a: [1, 2, 3, 4, 5], b: [6, 6, 6, 6, 6] });
        r = placeBid(r, "a", 2, 6);
        assert.strictEqual(currentPlayer(r), "b");
        assert.throws(() => placeBid(r, "b", 2, 5), /喊得比上一手大/);
        assert.throws(() => placeBid(r, "a", 3, 6), /還沒輪到你/);
        assert.throws(() => placeBid(r, "b", 11, 6), /顆數/);
        assert.throws(() => placeBid(r, "b", 3, 7), /點數/);
        assert.throws(() => placeBid(r, "b", 2.5, 6), /顆數/);
    });

    it("抓吹牛：真的有那麼多顆，抓的人輸；不夠，喊的人輸", () => {
        let r = round({ a: [6, 1, 1, 1, 1], b: [6, 6, 2, 2, 2] }); // 全桌 3 顆 6
        r = placeBid(r, "a", 3, 6);
        assert.deepStrictEqual(challenge(r, "b"), { loser: "b", reason: "challenge-failed", actual: 3 });

        let r2 = round({ a: [6, 1, 1, 1, 1], b: [6, 6, 2, 2, 2] });
        r2 = placeBid(r2, "a", 4, 6);
        assert.deepStrictEqual(challenge(r2, "b"), { loser: "a", reason: "caught", actual: 3 });
    });

    it("還沒人喊不能抓", () => {
        assert.throws(() => challenge(round({ a: [1], b: [2] }), "a"), /還沒有人喊/);
    });

    it("輸的人輸掉押的籌碼，其他人平分，總和 0", () => {
        assert.deepStrictEqual(settleLiar(["a", "b", "c"], "b", 50), { b: -50, a: 25, c: 25 });
        const odd = settleLiar(["a", "b", "c", "d"], "a", 50); // 50 分 3 人：17、17、16
        assert.deepStrictEqual(odd, { a: -50, b: 17, c: 17, d: 16 });
        assert.strictEqual(sum(odd), 0);
    });

    it("逾時或離開的人算輸", () => {
        assert.deepStrictEqual(forfeit("c"), { loser: "c", reason: "forfeit" });
    });
});
