import type { Request, Response } from "express";
import { JWT } from "colyseus";
import type { TownUser } from "../auth/discordLogin.js";
import { database } from "../db.js";
import { PlatformUnavailable, platform } from "../platform/platform.js";
import { MapImportError, validateImport } from "./importMap.js";
import { MAX_PROMPT, PlannerRejected, PlannerUnavailable, toTownPlan, townPlanner } from "./planTown.js";
import { TownSettings } from "./TownSettings.js";

/**
 * POST /town_map：管理員選小鎮的地圖。要帶小鎮 token。三種：
 * - { reset: true }：照頻道自動產生（依 Discord 分類分區）
 * - { prompt }：Claude 依頻道清單和這段描述設計分區
 * - { map, images }：匯入 tilemap.dev 或 Tiled 匯出的地圖
 * 存好之後，正在開的小鎮會收到通知重畫，所有在線成員一起換成新地圖。選過一次，管理員進小鎮就不會再跳出選地圖的畫面。
 */
export async function townMapRoute(req: Request, res: Response) {
    const reply = (status: number, ok: boolean, message: string) => res.status(status).send({ ok, message });

    const token = req.headers.authorization?.replace(/^Bearer /, "");
    const user = token ? await JWT.verify<TownUser>(token).catch((): undefined => undefined) : undefined;
    if (!user) return reply(401, false, "登入已失效，請重新打開親親小鎮");
    const isAdmin = await platform().isAdmin(user.guildId, user.id).catch(() => false);
    if (!isAdmin) return reply(403, false, "只有管理員（有「管理伺服器」權限）能換地圖");

    const settings = new TownSettings(database());
    const body = req.body ?? {};

    if (body.reset === true) {
        settings.setCustomMap(user.guildId, undefined);
        settings.setMapPlan(user.guildId, null);
        return reply(200, true, "改成照頻道自動產生的小鎮了（依 Discord 分類分區）");
    }

    if (typeof body.prompt === "string") {
        const prompt = body.prompt.trim();
        if (!prompt) return reply(400, false, "請寫一段想要的小鎮樣子");
        if (prompt.length > MAX_PROMPT) return reply(400, false, `描述太長了，請在 ${MAX_PROMPT} 個字以內`);
        try {
            const channels = await platform().channels(user.guildId);
            if (!channels?.length) return reply(400, false, "讀不到這個伺服器的頻道，請先邀請親親小鎮的 bot");
            const output = await townPlanner()(channels, prompt);
            settings.setCustomMap(user.guildId, undefined);
            settings.setMapPlan(user.guildId, toTownPlan(output, channels));
            return reply(200, true, `Claude 設計好了：${output.summary}`);
        } catch (e) {
            if (e instanceof PlannerUnavailable || e instanceof PlannerRejected || e instanceof PlatformUnavailable) return reply(400, false, e.message);
            console.error("Claude 設計小鎮失敗", e);
            return reply(502, false, "Claude 暫時沒辦法設計，請稍後再試");
        }
    }

    try {
        settings.setCustomMap(user.guildId, validateImport(body.map, body.images));
        if (settings.mapPlan(user.guildId) === undefined) settings.setMapPlan(user.guildId, null); // 記下選過了
        reply(200, true, "地圖匯入好了，大家都換成新地圖");
    } catch (e) {
        if (!(e instanceof MapImportError)) throw e;
        reply(400, false, e.message);
    }
}
