import type { Client } from "colyseus";
import { database } from "../../db.js";
import { MemberSettings } from "../../members/MemberSettings.js";
import { parseAppearance } from "../../town/appearance.js";
import { memberOf } from "../Town.js";
import { TownFeature, type MessageHandler } from "./TownFeature.js";

/**
 * 換裝：成員自己選角色的部件和顏色，存進資料庫，其他人看到的也是新外觀。
 * 第一次進小鎮的人會先跳出捏角色畫面。
 */
export class Wardrobe extends TownFeature {
    settings = new MemberSettings(database());

    messages(): Record<string, MessageHandler> {
        return { setLook: (client, look) => this.setLook(client, look) };
    }

    onJoin(client: Client) {
        // 沒存過外觀的人 look 留空字串：前端用預設外觀畫，並打開捏角色畫面（存檔後就有值，不會再跳）
        const member = memberOf(client);
        this.town.state.characters.get(client.sessionId)!.look = this.settings.hasAppearance(member) ? JSON.stringify(this.settings.appearance(member)) : "";
    }

    /** 前端送來的外觀要每個部件都是可選的；他每個分頁的角色都一起換。 */
    private setLook(client: Client, input: unknown) {
        const look = parseAppearance(input);
        if (!look) return client.send("wardrobeResult", { ok: false, message: "有部件不能選，請重新選一次" });
        this.settings.setAppearance(memberOf(client), look);
        const json = JSON.stringify(look);
        this.town.forEachCharacterOf(client.auth.id, (character) => (character.look = json));
        client.send("wardrobeResult", { ok: true, message: "換好了" });
    }
}
