import assert from "assert";
import { DatabaseSync } from "node:sqlite";
import { ChipLedger, ChipError, WELCOME_CHIPS, CHECKIN_CHIPS, RELIEF_CHIPS } from "../src/chips/ChipLedger.js";

const xiaoming = { guildId: "9000000000000000001", userId: "1" };
const sameUserOtherTown = { guildId: "9000000000000000002", userId: "1" };

/** 台北時間的某個時刻。 */
const taipei = (iso: string) => new Date(`${iso}+08:00`);

describe("ChipLedger", () => {
    let ledger: ChipLedger;
    beforeEach(() => (ledger = new ChipLedger(new DatabaseSync(":memory:"))));

    describe("新成員發放", () => {
        it("第一次進小鎮拿到 1000", () => {
            assert.strictEqual(WELCOME_CHIPS, 1000);
            assert.strictEqual(ledger.welcome(xiaoming), 1000);
            assert.strictEqual(ledger.balance(xiaoming), 1000);
        });

        it("只發一次：再進來不會再拿", () => {
            ledger.welcome(xiaoming);
            assert.strictEqual(ledger.welcome(xiaoming), 1000);
            assert.strictEqual(ledger.history(xiaoming).length, 1);
        });

        it("每座小鎮的籌碼分開算", () => {
            ledger.welcome(xiaoming);
            ledger.checkIn(xiaoming, taipei("2026-11-21T10:00:00"));
            assert.strictEqual(ledger.welcome(sameUserOtherTown), 1000);
        });

        it("還沒進過小鎮的人餘額是 0", () => {
            assert.strictEqual(ledger.balance(xiaoming), 0);
        });
    });

    describe("每日簽到", () => {
        beforeEach(() => ledger.welcome(xiaoming));

        it("簽到拿 200", () => {
            assert.strictEqual(CHECKIN_CHIPS, 200);
            assert.strictEqual(ledger.checkIn(xiaoming, taipei("2026-11-21T10:00:00")), 1200);
        });

        it("同一天（台北時間）重複簽到被拒", () => {
            ledger.checkIn(xiaoming, taipei("2026-11-21T00:00:00"));
            assert.throws(() => ledger.checkIn(xiaoming, taipei("2026-11-21T23:59:59")), ChipError);
            assert.strictEqual(ledger.balance(xiaoming), 1200);
        });

        it("以台北時間換日：UTC 還是同一天，台北已經過午夜就能再簽", () => {
            ledger.checkIn(xiaoming, new Date("2026-11-21T15:00:00Z")); // 台北 11-21 23:00
            assert.strictEqual(ledger.checkIn(xiaoming, new Date("2026-11-21T16:30:00Z")), 1400); // 台北 11-22 00:30
        });

        it("還沒進過小鎮不能簽到", () => {
            assert.throws(() => ledger.checkIn(sameUserOtherTown, taipei("2026-11-21T10:00:00")), ChipError);
        });
    });

    describe("救濟金", () => {
        beforeEach(() => ledger.welcome(xiaoming));

        it("還有籌碼時不能領", () => {
            assert.throws(() => ledger.claimRelief(xiaoming), ChipError);
        });

        it("歸零時可以領", () => {
            ledger.change(xiaoming, -1000, "bet");
            assert.strictEqual(ledger.claimRelief(xiaoming), RELIEF_CHIPS);
        });

        it("領過就不能再領，就算又歸零", () => {
            ledger.change(xiaoming, -1000, "bet");
            ledger.claimRelief(xiaoming);
            ledger.change(xiaoming, -RELIEF_CHIPS, "bet");
            assert.throws(() => ledger.claimRelief(xiaoming), ChipError);
            assert.strictEqual(ledger.balance(xiaoming), 0);
        });
    });

    describe("下注與結算", () => {
        beforeEach(() => ledger.welcome(xiaoming));

        it("餘額不夠時下注被拒，餘額不會變負數", () => {
            assert.throws(() => ledger.change(xiaoming, -1001, "bet"), ChipError);
            assert.strictEqual(ledger.balance(xiaoming), 1000);
        });

        it("剛好押光可以，餘額是 0", () => {
            assert.strictEqual(ledger.change(xiaoming, -1000, "bet"), 0);
        });

        it("結算贏的籌碼加回去", () => {
            ledger.change(xiaoming, -100, "bet");
            assert.strictEqual(ledger.change(xiaoming, 200, "payout"), 1100);
        });

        it("金額必須是整數", () => {
            assert.throws(() => ledger.change(xiaoming, 0.5, "payout"), ChipError);
            assert.throws(() => ledger.change(xiaoming, NaN, "payout"), ChipError);
        });
    });

    it("每筆變動都記下原因與變動後的餘額", () => {
        ledger.welcome(xiaoming);
        ledger.checkIn(xiaoming, taipei("2026-11-21T10:00:00"));
        ledger.change(xiaoming, -1200, "bet");
        ledger.claimRelief(xiaoming);
        ledger.change(xiaoming, 50, "payout");

        assert.deepStrictEqual(
            ledger.history(xiaoming).map((e) => [e.reason, e.delta, e.balance]),
            [
                ["welcome", 1000, 1000],
                ["checkin", 200, 1200],
                ["bet", -1200, 0],
                ["relief", RELIEF_CHIPS, RELIEF_CHIPS],
                ["payout", 50, RELIEF_CHIPS + 50],
            ],
        );
    });

    it("沒有任何付費取得或兌現的方法（ADR-0005）", () => {
        const methods = Object.getOwnPropertyNames(ChipLedger.prototype);
        const moneyish = methods.filter((m) => /buy|purchase|pay(?!out)|cash|redeem|exchange|withdraw|sell/i.test(m));
        assert.deepStrictEqual(moneyish, []);
    });
});
