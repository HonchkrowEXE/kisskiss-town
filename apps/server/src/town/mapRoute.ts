import type { Request, Response } from "express";
import { JWT } from "colyseus";
import type { TownUser } from "../auth/discordLogin.js";
import { database } from "../db.js";
import { platform } from "../platform/platform.js";
import { MapImportError, validateImport } from "./importMap.js";
import { TownSettings } from "./TownSettings.js";

/**
 * POST /town_map：管理員匯入自訂地圖 { map, images }，或改回自動 { reset: true }。要帶小鎮 token。
 * 存好之後，正在開的小鎮會收到通知重畫，所有在線成員一起換成新地圖。
 */
export async function townMapRoute(req: Request, res: Response) {
    const reply = (status: number, ok: boolean, message: string) => res.status(status).send({ ok, message });

    const token = req.headers.authorization?.replace(/^Bearer /, "");
    const user = token ? await JWT.verify<TownUser>(token).catch((): undefined => undefined) : undefined;
    if (!user) return reply(401, false, "登入已失效，請重新打開親親小鎮");
    const isAdmin = await platform().isAdmin(user.guildId, user.id).catch(() => false);
    if (!isAdmin) return reply(403, false, "只有管理員（有「管理伺服器」權限）能換地圖");

    const settings = new TownSettings(database());
    if (req.body?.reset === true) {
        settings.setCustomMap(user.guildId, undefined);
        return reply(200, true, "改回自動長出來的小鎮了");
    }
    try {
        settings.setCustomMap(user.guildId, validateImport(req.body?.map, req.body?.images));
        reply(200, true, "地圖匯入好了，大家都換成新地圖");
    } catch (e) {
        if (!(e instanceof MapImportError)) throw e;
        reply(400, false, e.message);
    }
}
