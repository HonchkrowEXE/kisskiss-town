import assert from "assert";
import { DiceError, emptyRound, joinRound, leaveRound, settleRound } from "../src/games/diceDuel.js";

const sum = (deltas: Record<string, number>) => Object.values(deltas).reduce((a, b) => a + b, 0);

describe("骰子比大小規則", () => {
    it("點數最大的人拿走彩池，其他人輸掉押的籌碼", () => {
        const result = settleRound({ players: ["a", "b", "c"] }, { a: [6, 5], b: [1, 2], c: [3, 3] }, 50);
        assert.deepStrictEqual(result.winners, ["a"]);
        assert.deepStrictEqual(result.deltas, { a: 100, b: -50, c: -50 });
    });

    it("同點平分彩池", () => {
        const result = settleRound({ players: ["a", "b", "c", "d"] }, { a: [6, 6], b: [1, 1], c: [6, 6], d: [2, 2] }, 50);
        assert.deepStrictEqual(result.winners, ["a", "c"]);
        assert.deepStrictEqual(result.deltas, { a: 50, b: -50, c: 50, d: -50 });
    });

    it("除不盡時零頭依下注順序每人多 1，總和仍是 0（籌碼不會憑空多或少）", () => {
        const result = settleRound({ players: ["a", "b", "c"] }, { a: [5, 5], b: [4, 6], c: [1, 1] }, 25);
        // 彩池 75，兩人平分：38、37
        assert.deepStrictEqual(result.deltas, { a: 13, b: 12, c: -25 });
        assert.strictEqual(sum(result.deltas), 0);
    });

    it("全部同點時大家不輸不贏", () => {
        const result = settleRound({ players: ["a", "b"] }, { a: [3, 4], b: [2, 5] }, 50);
        assert.deepStrictEqual(result.deltas, { a: 0, b: 0 });
    });

    it("不到兩個人下注不能擲骰", () => {
        assert.throws(() => settleRound({ players: ["a"] }, { a: [1, 1] }), DiceError);
    });

    it("籌碼不夠不能下注，同一局不能下注兩次", () => {
        assert.throws(() => joinRound(emptyRound(), "a", 49, 50), /籌碼不夠/);
        assert.throws(() => joinRound({ players: ["a"] }, "a", 1000, 50), /已經下注/);
        assert.deepStrictEqual(joinRound(emptyRound(), "a", 50, 50), { players: ["a"] });
    });

    it("擲骰前離開就退出這一局", () => {
        assert.deepStrictEqual(leaveRound({ players: ["a", "b"] }, "a"), { players: ["b"] });
    });

    it("點數不合法（不是 1～6 的整數或缺人）時拒絕結算", () => {
        assert.throws(() => settleRound({ players: ["a", "b"] }, { a: [7, 1], b: [1, 1] }));
        assert.throws(() => settleRound({ players: ["a", "b"] }, { a: [1, 1] }));
    });
});
