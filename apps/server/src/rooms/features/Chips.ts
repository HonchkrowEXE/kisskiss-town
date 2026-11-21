import type { Client } from "colyseus";
import { ChipError, type ChipOwner } from "../../chips/ChipLedger.js";
import { memberOf } from "../Town.js";
import { TownFeature, type MessageHandler } from "./TownFeature.js";

/** 籌碼：第一次進小鎮發放、每天簽到、歸零時領救濟金（規則在 ChipLedger）。 */
export class Chips extends TownFeature {
    messages(): Record<string, MessageHandler> {
        return {
            checkIn: (client) => this.change(client, (owner) => this.town.ledger.checkIn(owner), "簽到成功"),
            claimRelief: (client) => this.change(client, (owner) => this.town.ledger.claimRelief(owner), "領到救濟金"),
        };
    }

    onJoin(client: Client) {
        this.town.state.characters.get(client.sessionId)!.chips = this.town.ledger.welcome(memberOf(client));
    }

    /** 經籌碼帳本改餘額，結果（成功或被拒的原因）傳回給那位成員；他每個分頁的角色都更新成新餘額。 */
    private change(client: Client, action: (owner: ChipOwner) => number, okMessage: string) {
        try {
            const balance = action(memberOf(client));
            this.town.forEachCharacterOf(client.auth.id, (character) => (character.chips = balance));
            client.send("chipResult", { ok: true, message: okMessage });
        } catch (e) {
            if (!(e instanceof ChipError)) throw e;
            client.send("chipResult", { ok: false, message: e.message });
        }
    }
}
