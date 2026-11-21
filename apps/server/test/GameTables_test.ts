import assert from "assert";
import type { ColyseusTestServer } from "@colyseus/testing";
import { JWT } from "colyseus";
import type appConfig from "../src/app.config.js";
import { testServer, fakePlatform } from "./testServer.js";
import type { TownRoom } from "../src/rooms/TownRoom.js";
import { defaultTables, seatsAround, type GameKind } from "../src/town/tables.js";
import { setLiarTurnMs } from "../src/rooms/features/tables/LiarDiceGame.js";
import { setBlackjackTurnMs } from "../src/rooms/features/tables/BlackjackGame.js";

const GUILD_A = "9000000000000000001";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("遊戲桌", () => {
    let colyseus: ColyseusTestServer<typeof appConfig>;

    before(async () => (colyseus = await testServer()));
    beforeEach(async () => colyseus.cleanup());

    /** 每個測試用不同的成員，資料庫在整個測試程序裡共用。 */
    let nextId = 3000;
    async function enter(name: string, user = { id: `${nextId++}`, name, guildId: GUILD_A }) {
        colyseus.sdk.auth.token = await JWT.sign(user);
        const client = await colyseus.sdk.joinOrCreate("town", { guildId: GUILD_A });
        const server = colyseus.getRoomById(client.roomId) as unknown as TownRoom;
        await server.waitForNextPatch();
        const results: { ok: boolean; message: string }[] = [];
        const admin: { ok: boolean; message: string }[] = [];
        let secret: unknown = null;
        client.onMessage("tableResult", (r: { ok: boolean; message: string }) => results.push(r));
        client.onMessage("adminResult", (r: { ok: boolean; message: string }) => admin.push(r));
        client.onMessage("tablePrivate", (p: { data: unknown }) => (secret = p.data));
        const character = server.state.characters.get(client.sessionId);

        /** 送出訊息，等伺服器處理完；回傳這段時間伺服器回的最後一句提示（沒有就是 undefined）。 */
        async function send(type: string, payload?: unknown, log = results) {
            const before = log.length;
            client.send(type, payload);
            await server.waitForMessage(type);
            await wait(30);
            return log.length > before ? log.at(-1) : undefined;
        }
        /** 站到某種遊戲的桌子旁邊。 */
        function walkTo(game: GameKind) {
            const table = [...server.state.tables.values()].find((t) => t.game === game)!;
            Object.assign(character.position, { x: table.x, y: table.y - 28 });
        }
        /** 坐著的那張桌子的公開畫面。 */
        const view = () => JSON.parse(server.state.tables.get(character.seatedAt)!.view);
        return {
            client, server, user, character, results, send, walkTo, view,
            act: (action: string, extra: object = {}) => send("tableAction", { action, ...extra }),
            editTables: (type: string, payload: unknown) => send(type, payload, admin),
            secret: () => secret,
        };
    }

    async function seatedAt(game: GameKind, name: string) {
        const p = await enter(name);
        p.walkTo(game);
        assert.strictEqual((await p.send("sit"))?.ok, true);
        return p;
    }

    const balance = (p: { server: TownRoom; user: { id: string } }) => p.server.ledger.balance({ guildId: GUILD_A, userId: p.user.id });

    describe("入座", () => {
        it("預設有三張桌子：骰子、21 點、吹牛", async () => {
            const a = await enter("小明");
            assert.deepStrictEqual([...a.server.state.tables.values()].map((t) => t.game).sort(), ["blackjack", "dice", "liar"]);
        });

        it("走到桌旁入座：站到座位上，大家看得到誰坐哪；坐著不能走動", async () => {
            const a = await seatedAt("dice", "小明");
            const table = a.server.state.tables.get(a.character.seatedAt)!;
            const seat = seatsAround(table.x, table.y)[0];

            assert.deepStrictEqual([a.character.position.x, a.character.position.y], [seat.x, seat.y]);
            await a.server.waitForNextPatch();
            await wait(20);
            assert.strictEqual(a.client.state.tables.get(a.character.seatedAt).seats[0], a.client.sessionId);

            a.client.send("move", { x: seat.x, y: seat.y + 4, dir: "down" });
            await a.server.waitForMessage("move");
            assert.strictEqual(a.character.position.y, seat.y);
        });

        it("離桌子太遠不能入座；同一個帳號不能在兩個分頁都入座", async () => {
            const a = await enter("小明");
            assert.deepStrictEqual(await a.send("sit"), { ok: false, message: "旁邊沒有遊戲桌" });
            a.walkTo("dice");
            await a.send("sit");
            const tab2 = await enter("小明", a.user);
            tab2.walkTo("dice");
            assert.deepStrictEqual(await tab2.send("sit"), { ok: false, message: "你已經在另一個分頁入座了" });
        });

        it("起身後可以走動；沒入座不能玩", async () => {
            const a = await seatedAt("dice", "小明");
            await a.send("stand");
            await wait(200); // 起身後從座位重新累積移動額度
            const { x, y } = a.character.position;
            a.client.send("move", { x, y: y - 4, dir: "up" });
            await a.server.waitForMessage("move");
            assert.strictEqual(a.character.position.y, y - 4);
            assert.deepStrictEqual(await a.act("bet"), { ok: false, message: "先入座才能玩" });
        });

        it("不認得的動作被拒", async () => {
            const a = await seatedAt("dice", "小明");
            assert.deepStrictEqual(await a.act("cheat"), { ok: false, message: "這張桌子沒有這個動作" });
            assert.deepStrictEqual(await a.send("tableAction", "garbage"), { ok: false, message: "這張桌子沒有這個動作" });
        });
    });

    describe("骰子比大小", () => {
        it("一個人下注不能擲骰", async () => {
            const a = await seatedAt("dice", "小明");
            await a.act("bet");
            assert.deepStrictEqual(await a.act("roll"), { ok: false, message: "至少要兩個人下注才能擲骰" });
        });

        it("兩人下注擲骰：籌碼立刻更新、總數不變，結果大家看得到", async () => {
            const a = await seatedAt("dice", "小明");
            const b = await seatedAt("dice", "小華");
            await a.act("bet");
            await b.act("bet");
            assert.strictEqual(a.view().bettors.length, 2);

            await a.act("roll");

            assert.strictEqual(a.character.chips + b.character.chips, 2000);
            assert.ok([950, 1000, 1050].includes(a.character.chips), `${a.character.chips}`);
            assert.deepStrictEqual(a.view().result.map((r: { name: string }) => r.name), ["小明", "小華"]);
            assert.strictEqual(a.view().bettors.length, 0);
            assert.strictEqual(balance(a), a.character.chips);
        });

        it("下注後籌碼在別處用掉了：擲骰時他退出這一局，沒有人被扣到一半", async () => {
            const a = await seatedAt("dice", "小明");
            const b = await seatedAt("dice", "小華");
            await a.act("bet");
            await b.act("bet");
            a.server.ledger.change({ guildId: GUILD_A, userId: b.user.id }, -1000, "bet");

            assert.deepStrictEqual(await a.act("roll"), { ok: false, message: "至少要兩個人下注才能擲骰" });
            assert.deepStrictEqual(a.view().bettors, [a.client.sessionId]);
            assert.deepStrictEqual(b.results.at(-1), { ok: false, message: "籌碼不夠 50，退出這一局" });
            assert.strictEqual(balance(a), 1000);
        });

        it("籌碼不夠不能下注", async () => {
            const a = await seatedAt("dice", "小明");
            a.server.ledger.change({ guildId: GUILD_A, userId: a.user.id }, -980, "bet");
            assert.deepStrictEqual(await a.act("bet"), { ok: false, message: "籌碼不夠，每局要 50" });
        });

        it("擲骰前有人斷線：他退出這一局、不扣籌碼，座位空出來", async () => {
            const a = await seatedAt("dice", "小明");
            const b = await seatedAt("dice", "小華");
            await a.act("bet");
            await b.act("bet");

            await b.client.leave();
            await wait(50);

            assert.deepStrictEqual(a.view().bettors, [a.client.sessionId]);
            assert.strictEqual(a.server.state.tables.get(a.character.seatedAt)!.seats.filter((s) => s !== "").length, 1);
            assert.strictEqual(balance(b), 1000);
        });
    });

    describe("21 點", () => {
        afterEach(() => setBlackjackTurnMs(30_000));

        it("下注發牌：莊家只露一張；停牌後莊家翻牌結算，籌碼和帳本立刻更新", async () => {
            const a = await seatedAt("blackjack", "小明");
            assert.deepStrictEqual(await a.act("deal"), { ok: false, message: "先下注才能發牌" });
            await a.act("bet");
            await a.act("deal");

            if (a.view().phase === "playing") {
                assert.strictEqual(a.view().dealer.length, 1, "進行中只能看到莊家一張牌");
                assert.strictEqual(a.view().turn, a.client.sessionId);
                await a.act("stand");
            }
            const view = a.view();
            assert.strictEqual(view.phase, "betting");
            assert.ok(view.dealer.length >= 2, "結算後莊家的牌全部公開");
            const delta = view.result[0].delta;
            assert.ok([-50, 0, 50, 75].includes(delta), `${delta}`);
            assert.strictEqual(a.character.chips, 1000 + delta);
            assert.strictEqual(balance(a), 1000 + delta);
        });

        it("沒輪到的人不能要牌；牌堆不會出現在公開畫面", async () => {
            const a = await seatedAt("blackjack", "小明");
            const b = await seatedAt("blackjack", "小華");
            await a.act("bet");
            await b.act("bet");
            await a.act("deal");
            const view = a.view();
            assert.strictEqual(JSON.stringify(view).includes("deck"), false);
            if (view.phase !== "playing" || !view.turn) return; // 兩人都黑傑克時直接結算
            const notTurn = view.turn === a.client.sessionId ? b : a;
            assert.deepStrictEqual(await notTurn.act("hit"), { ok: false, message: "還沒輪到你" });
        });

        it("發牌後有人斷線：算他停牌，照樣結算（押的籌碼已經在桌上）", async () => {
            const a = await seatedAt("blackjack", "小明");
            await a.act("bet");
            await a.act("deal");
            const before = a.view();
            await a.client.leave();
            await wait(50);
            if (before.phase === "playing") {
                const history = a.server.ledger.history({ guildId: GUILD_A, userId: a.user.id });
                assert.ok(history.some((h) => h.reason === "bet"), "斷線的人照樣結算");
            }
        });

        it("輪到的人逾時沒動作就自動停牌", async () => {
            setBlackjackTurnMs(100);
            const a = await seatedAt("blackjack", "小明");
            await a.act("bet");
            await a.act("deal");
            await wait(400);
            assert.strictEqual(a.view().phase, "betting");
            assert.strictEqual(a.view().result.length, 1);
        });
    });

    describe("吹牛", () => {
        afterEach(() => setLiarTurnMs(30_000));

        async function startedLiar() {
            const a = await seatedAt("liar", "小明");
            const b = await seatedAt("liar", "小華");
            await a.act("join");
            assert.deepStrictEqual(await a.act("start"), { ok: false, message: "至少要兩個人才能開局" });
            await b.act("join");
            await a.act("start");
            return { a, b };
        }

        it("每個人只看得到自己的骰子，公開畫面只有顆數", async () => {
            const { a, b } = await startedLiar();
            assert.strictEqual((a.secret() as number[]).length, 5);
            assert.strictEqual((b.secret() as number[]).length, 5);
            const view = a.view();
            assert.deepStrictEqual(view.players.map((p: { dice: number }) => p.dice), [5, 5]);
            assert.strictEqual(JSON.stringify(view).includes(JSON.stringify(a.secret())), false);
        });

        it("喊價要比上一手大；抓吹牛後開盅結算，輸的人付給其他人，總數不變", async () => {
            const { a, b } = await startedLiar();
            await a.act("bid", { count: 2, face: 3 });
            assert.deepStrictEqual(await b.act("bid", { count: 2, face: 2 }), { ok: false, message: "要喊得比上一手大：顆數更多，或顆數一樣但點數更大" });
            await b.act("challenge");

            const result = a.view().result;
            assert.ok(["小明", "小華"].includes(result.loser));
            assert.deepStrictEqual(Object.keys(result.dice).sort(), ["小明", "小華"].sort());
            assert.strictEqual(a.character.chips + b.character.chips, 2000);
            assert.strictEqual(Math.abs(a.character.chips - 1000), 50);
            assert.strictEqual(a.secret(), null, "開盅後私人骰子收掉");
        });

        it("輪到的人逾時沒動作就算輸", async () => {
            setLiarTurnMs(100);
            const { a, b } = await startedLiar();
            await wait(400);
            assert.deepStrictEqual([a.view().result.loser, a.view().result.reason], ["小明", "逾時或離開"]);
            assert.strictEqual(b.character.chips, 1050);
        });

        it("開局後有人離開就算他輸", async () => {
            const { a, b } = await startedLiar();
            await b.client.leave();
            await wait(50);
            assert.deepStrictEqual([a.view().result.loser, a.view().result.reason], ["小華", "逾時或離開"]);
            assert.strictEqual(a.character.chips, 1050);
        });
    });

    describe("管理員擺桌子", () => {
        afterEach(() => fakePlatform.admins.clear());

        async function admin() {
            const p = await enter("鎮長");
            fakePlatform.admins.add(p.user.id);
            return p;
        }
        const reset = (p: { server: TownRoom }) => p.server.townSettings.setTables(GUILD_A, defaultTables(p.server.layout));

        it("管理員在空地放一張桌子，大家看得到；重開小鎮還在", async () => {
            const p = await admin();
            Object.assign(p.character.position, { x: 312, y: 48 });
            assert.deepStrictEqual(await p.editTables("placeTable", { game: "liar" }), { ok: true, message: "在這裡放了一張吹牛桌" });
            const placed = [...p.server.state.tables.values()].find((t) => t.x === 312 && t.y === 48);
            assert.strictEqual(placed?.game, "liar");
            assert.strictEqual(p.server.townSettings.tables(GUILD_A)?.length, 4);
            reset(p);
        });

        it("放不下的地方（房間裡、離別張桌子太近）被拒", async () => {
            const p = await admin();
            const room = p.server.layout.rooms[0].rect;
            Object.assign(p.character.position, { x: room.x + room.width / 2, y: room.y + room.height / 2 });
            assert.strictEqual((await p.editTables("placeTable", { game: "dice" }))?.ok, false);
            const dice = [...p.server.state.tables.values()].find((t) => t.game === "dice")!;
            Object.assign(p.character.position, { x: dice.x + 20, y: dice.y });
            assert.deepStrictEqual(await p.editTables("placeTable", { game: "dice" }), { ok: false, message: "離別張桌子太近了" });
            assert.deepStrictEqual(await p.editTables("placeTable", { game: "poker" }), { ok: false, message: "要選一種遊戲" });
            reset(p);
        });

        it("搬桌子：坐著的人先起身，桌子換到管理員站的地方；移除桌子", async () => {
            const sitter = await seatedAt("dice", "小華");
            const p = await admin();
            const tableId = sitter.character.seatedAt;
            Object.assign(p.character.position, { x: 400, y: 48 });

            assert.strictEqual((await p.editTables("moveTable", { tableId }))?.ok, true);
            assert.deepStrictEqual([p.server.state.tables.get(tableId)!.x, p.server.state.tables.get(tableId)!.y], [400, 48]);
            assert.strictEqual(sitter.character.seatedAt, "");

            assert.strictEqual((await p.editTables("removeTable", { tableId }))?.ok, true);
            assert.strictEqual(p.server.state.tables.has(tableId), false);
            assert.deepStrictEqual(await p.editTables("removeTable", { tableId }), { ok: false, message: "找不到這張桌子" });
            reset(p);
        });

        it("一般成員不能擺桌子", async () => {
            const p = await enter("小明");
            Object.assign(p.character.position, { x: 312, y: 48 });
            assert.deepStrictEqual(await p.editTables("placeTable", { game: "dice" }), { ok: false, message: "只有管理員（有「管理伺服器」權限）能擺遊戲桌" });
        });
    });
});
