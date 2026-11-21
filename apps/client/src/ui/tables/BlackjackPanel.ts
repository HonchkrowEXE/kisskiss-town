import type { Card } from "../../../../server/src/games/blackjack.js";
import { GamePanel, actionButton, actions, el, list, signed, type PanelContext } from "./GamePanel.js";

type BlackjackView = {
    stake: number;
    phase: "betting" | "playing";
    bettors: string[];
    dealer: Card[];
    dealerTotal?: number;
    players: { name: string; sessionId: string; cards: Card[]; total: number; done: boolean }[];
    turn?: string;
    result: { name: string; cards: Card[]; total: number; delta: number }[];
};

const cards = (list: Card[]) => list.map((c) => c.rank + c.suit).join(" ");

/** 21 點：下注、發牌、要牌、停牌。進行中莊家只露一張牌。 */
export class BlackjackPanel extends GamePanel<BlackjackView> {
    readonly hint = "跟莊家比誰接近 21 點，超過就爆牌。兩張就 21 點贏 1.5 倍；莊家不到 17 一定要牌。";

    render(view: BlackjackView, { me, nameOf }: PanelContext) {
        if (view.phase === "betting") {
            const bet = view.bettors.includes(me);
            const nodes: Node[] = [
                el("p", view.bettors.length ? `已下注：${view.bettors.map(nameOf).join("、")}` : "還沒有人下注"),
                actions(actionButton("bet", `下注 ${view.stake}`, bet), actionButton("deal", "發牌", !bet)),
            ];
            if (view.result.length) {
                nodes.push(
                    el("p", `上一局　莊家：${cards(view.dealer)}（${view.dealerTotal}）`),
                    list(view.result.map((r) => `${r.name}：${cards(r.cards)}（${r.total}），${signed(r.delta)}`), "table-result"),
                );
            }
            return nodes;
        }
        const myTurn = view.turn === me;
        return [
            el("p", `莊家：${cards(view.dealer)} 🂠`),
            list(view.players.map((p) => `${p.name}：${cards(p.cards)}（${p.total}）${p.total > 21 ? " 爆牌" : p.done ? " 停牌" : ""}`)),
            el("p", myTurn ? "輪到你了" : `輪到 ${view.turn ? nameOf(view.turn) : "莊家"}`),
            actions(actionButton("hit", "要牌", !myTurn), actionButton("stand", "停牌", !myTurn)),
        ];
    }
}
