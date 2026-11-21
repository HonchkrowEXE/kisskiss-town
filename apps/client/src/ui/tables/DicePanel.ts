import { GamePanel, actionButton, actions, el, list, signed, type PanelContext } from "./GamePanel.js";

type DiceView = { stake: number; bettors: string[]; result: { name: string; dice: [number, number]; delta: number }[] };

/** 骰子比大小：下注、擲骰、上一局結果。 */
export class DicePanel extends GamePanel<DiceView> {
    readonly hint = "每人擲兩顆，點數和最大的人拿走彩池，同點平分。";

    render(view: DiceView, { me, nameOf }: PanelContext) {
        const bet = view.bettors.includes(me);
        const nodes: Node[] = [
            el("p", view.bettors.length ? `已下注：${view.bettors.map(nameOf).join("、")}` : "還沒有人下注"),
            actions(actionButton("bet", `下注 ${view.stake}`, bet), actionButton("roll", "擲骰", !bet)),
        ];
        if (view.result.length) {
            nodes.push(el("p", "上一局"), list(view.result.map((r) => `${r.name}：${r.dice[0]} + ${r.dice[1]} = ${r.dice[0] + r.dice[1]}，${signed(r.delta)}`), "table-result"));
        }
        return nodes;
    }
}
