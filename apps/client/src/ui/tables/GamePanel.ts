/** 畫遊戲畫面時知道的事。 */
export type PanelContext = {
    /** 自己的 sessionId。 */
    me: string;
    /** sessionId → 名字。 */
    nameOf(sessionId: string): string;
    /** 只有自己看得到的東西（例如自己的骰子）；沒有是 null。 */
    secret: unknown;
};

/** 名字是成員自己取的，一律用 textContent，不拼 HTML。 */
export const el = (tag: string, text = "", className = "") => Object.assign(document.createElement(tag), { textContent: text, className });

/** 遊戲動作的按鈕：按下去送 tableAction { action }；放在 .table-form 裡的話，表單裡的數字欄位也一起送。 */
export function actionButton(action: string, text: string, disabled = false) {
    const b = Object.assign(el("button", text) as HTMLButtonElement, { type: "button", disabled });
    b.dataset.action = action;
    return b;
}

/** 一列按鈕。 */
export const actions = (...buttons: HTMLElement[]) => {
    const row = el("div", "", "table-actions");
    row.append(...buttons);
    return row;
};

/** 一個清單。 */
export const list = (items: string[], className = "") => {
    const ul = el("ul", "", className);
    for (const text of items) ul.append(el("li", text));
    return ul;
};

/** 正負號：+50、-50、0。 */
export const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/**
 * 一種遊戲的畫面（伺服器 TableGame.publicView 的內容由那種遊戲決定）。
 * 加新遊戲時，寫一個類別繼承它，在 TablePanel 的 PANELS 加一行。
 */
export abstract class GamePanel<View = any> {
    /** 規則說明，顯示在標題下面。 */
    abstract readonly hint: string;
    /** 依公開畫面和自己的私人資料畫出遊戲區。 */
    abstract render(view: View, context: PanelContext): Node[];
}
