import { GamePanel, actionButton, actions, el, list, type PanelContext } from "./GamePanel.js";

type LiarView = {
    stake: number;
    phase: "waiting" | "playing";
    joined: string[];
    players: { sessionId: string; name: string; dice: number }[];
    turn?: string;
    bid?: { name: string; count: number; face: number };
    result?: { loser: string; reason: string; bid?: { by: string; count: number; face: number }; actual?: number; dice: Record<string, number[]> };
};

/** 吹牛：加入、開局、喊價、抓。自己的骰子是私人資料，開盅後才看得到全部。 */
export class LiarPanel extends GamePanel<LiarView> {
    readonly hint = "喊「全桌至少有幾顆幾點」，下一個人要喊更大或抓你吹牛。1 點不當萬用；逾時算輸。";

    render(view: LiarView, { me, nameOf, secret }: PanelContext) {
        if (view.phase === "waiting") {
            const joined = view.joined.includes(me);
            const nodes: Node[] = [
                el("p", view.joined.length ? `已加入：${view.joined.map(nameOf).join("、")}` : "還沒有人加入"),
                actions(actionButton("join", `加入（${view.stake} 籌碼）`, joined), actionButton("start", "開局", !joined || view.joined.length < 2)),
            ];
            const r = view.result;
            if (r) {
                const bid = r.bid ? `${r.bid.by} 喊 ${r.bid.count} 顆 ${r.bid.face} 點，全桌有 ${r.actual ?? "?"} 顆。` : "";
                nodes.push(
                    el("p", `上一局：${r.loser} 輸（${r.reason}）。${bid}`),
                    list(Object.entries(r.dice).map(([name, dice]) => `${name}：${dice.join(" ")}`), "table-result"),
                );
            }
            return nodes;
        }

        const myTurn = view.turn === me;
        const total = view.players.reduce((n, p) => n + p.dice, 0);
        const nodes: Node[] = [
            el("p", `你的骰子：${Array.isArray(secret) ? secret.join(" ") : "（看不到）"}`),
            el("p", view.bid ? `${view.bid.name} 喊：至少 ${view.bid.count} 顆 ${view.bid.face} 點` : `全桌共 ${total} 顆骰子，還沒有人喊`),
            el("p", myTurn ? "輪到你了" : `輪到 ${view.turn ? nameOf(view.turn) : ""}`),
        ];
        if (myTurn) {
            const form = el("div", "", "table-form");
            form.append(this.number("count", "顆數", 1, total, (view.bid?.count ?? 0) + 1 > total ? total : (view.bid?.count ?? 0) + 1), this.number("face", "點數", 1, 6, view.bid?.face ?? 2));
            form.append(actions(actionButton("bid", "喊"), actionButton("challenge", "抓！", !view.bid)));
            nodes.push(form);
        }
        return nodes;
    }

    private number(name: string, label: string, min: number, max: number, value: number) {
        const wrap = el("label", `${label} `);
        const input = Object.assign(document.createElement("input"), { type: "number", name, min: `${min}`, max: `${max}`, value: `${value}` });
        wrap.append(input);
        return wrap;
    }
}
