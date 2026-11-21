import type { Room } from "@colyseus/sdk";
import type { TownState } from "../../../server/src/rooms/schema/TownState.js";
import { CALL_RANGE } from "../../../server/src/town/calls.js";

/** 邀請多久沒回就收起來（毫秒，跟伺服器一樣）。 */
const INVITE_MS = 30_000;

const button = (text: string, onClick: () => void) => {
    const b = Object.assign(document.createElement("button"), { type: "button", textContent: text });
    b.addEventListener("click", onClick);
    return b;
};

/**
 * 點身邊的人跳出的選單（目前有「一對一通話」，之後的互動也加在這裡），
 * 以及被邀請時的「接受／拒絕」。
 */
export class CallMenu {
    /** 跟角色互動的範圍（像素）；TownScene 用它判斷點到的人夠不夠近。 */
    static readonly RANGE = CALL_RANGE;
    private menu = document.createElement("section");
    private invite = document.createElement("section");
    private room: Room<any, TownState>;
    private inviteTimer?: ReturnType<typeof setTimeout>;

    constructor(room: Room<any, TownState>) {
        this.room = room;
        for (const [el, label] of [[this.menu, "角色選單"], [this.invite, "通話邀請"]] as const) {
            el.className = "call-menu";
            el.hidden = true;
            el.setAttribute("aria-label", label);
            document.body.append(el);
        }
        this.invite.setAttribute("role", "alertdialog");
        room.onMessage("callInvite", ({ from, name }: { from: string; name: string }) => this.showInvite(from, name));
        document.addEventListener("keydown", (e) => e.key === "Escape" && this.close());
    }

    /** 點到一個人：顯示他的名字和能做的事；離太遠時說明要走近一點。 */
    open(sessionId: string, near: boolean) {
        const target = this.room.state.characters.get(sessionId);
        if (!target) return;
        const call = button("📞 一對一通話", () => {
            this.room.send("callInvite", { to: sessionId });
            this.close();
        });
        call.disabled = !near;
        this.menu.replaceChildren(
            Object.assign(document.createElement("b"), { textContent: target.name }),
            call,
            ...(near ? [] : [Object.assign(document.createElement("span"), { textContent: "走近一點才能通話" })]),
            button("關閉", () => this.close()),
        );
        this.menu.hidden = false;
    }

    close() {
        this.menu.hidden = true;
    }

    private showInvite(from: string, name: string) {
        const answer = (accept: boolean) => {
            this.room.send("callAnswer", { from, accept });
            this.invite.hidden = true;
            clearTimeout(this.inviteTimer);
        };
        this.invite.replaceChildren(
            Object.assign(document.createElement("p"), { textContent: `📞 ${name} 邀請你一對一通話` }),
            button("接受", () => answer(true)),
            button("拒絕", () => answer(false)),
        );
        this.invite.hidden = false;
        clearTimeout(this.inviteTimer);
        this.inviteTimer = setTimeout(() => (this.invite.hidden = true), INVITE_MS);
    }
}
