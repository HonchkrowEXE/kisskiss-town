import type { Client } from "colyseus";
import { platform } from "../../platform/platform.js";
import { TownFeature, type MessageHandler } from "./TownFeature.js";

/** 管理員（有「管理伺服器」權限的人）的設定。目前只有搧巴掌通知發在哪個文字頻道。 */
export class AdminSettings extends TownFeature {
    messages(): Record<string, MessageHandler> {
        return { setNotifyChannel: (client, channelId) => void this.setNotifyChannel(client, channelId) };
    }

    /** 管理員一進小鎮就收到目前的設定，前端才顯示設定選單。 */
    onJoin(client: Client) {
        void this.isAdmin(client).then((admin) => {
            if (admin) client.send("admin", { notifyChannel: this.town.townSettings.notifyChannel(this.town.guildId) ?? "" });
        });
    }

    /** 每次都問平台，不用快取：身分組隨時可能被改。 */
    private isAdmin(client: Client) {
        return platform().isAdmin(this.town.guildId, client.auth.id).catch(() => false);
    }

    /** 管理員改通知頻道：只能選小鎮上的文字房，給空字串改回系統訊息頻道。 */
    private async setNotifyChannel(client: Client, channelId: unknown) {
        const tell = (ok: boolean, message: string) => client.send("adminResult", { ok, message });
        if (!(await this.isAdmin(client))) return tell(false, "只有管理員（有「管理伺服器」權限）能改");
        const { townSettings, guildId, layout } = this.town;
        if (channelId === "") {
            townSettings.setNotifyChannel(guildId, undefined);
            return tell(true, "搧巴掌通知改回伺服器的系統訊息頻道");
        }
        const room = layout.rooms.find((r) => r.id === channelId && r.kind === "text");
        if (!room) return tell(false, "只能選小鎮上的文字頻道");
        townSettings.setNotifyChannel(guildId, room.id);
        tell(true, `搧巴掌通知改發在 #${room.name}`);
    }
}
