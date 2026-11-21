import type { Request, Response } from "express";
import { JWT } from "colyseus";
import type { TownUser } from "../auth/discordLogin.js";
import { PhotoRejected, PhotoUnavailable, featuresToAppearance, photoReader, type Photo } from "./photoLook.js";

/** 照片最大幾 MB（解碼後）。Claude API 一張圖的上限是 5 MB。 */
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/** 同一個人多久才能再用一次（毫秒）：每次都要付 Claude API 的錢。 */
const COOLDOWN_MS = 30_000;

const MEDIA_TYPES: Photo["mediaType"][] = ["image/jpeg", "image/png", "image/webp", "image/gif"];

const lastUsed = new Map<string, number>();

/**
 * POST /photo_look { mediaType, base64 }：照片 → 外觀。要帶登入時拿到的小鎮 token。
 * 照片只在這次請求的記憶體裡，不存檔、不寫進資料庫。
 */
export async function photoLookRoute(req: Request, res: Response) {
    const fail = (status: number, error: string) => res.status(status).send({ error });

    const token = req.headers.authorization?.replace(/^Bearer /, "");
    const user = token ? await JWT.verify<TownUser>(token).catch((): undefined => undefined) : undefined;
    if (!user) return fail(401, "登入已失效，請重新打開親親小鎮");

    const { mediaType, base64 } = req.body ?? {};
    if (!MEDIA_TYPES.includes(mediaType)) return fail(400, "只接受 JPEG、PNG、WebP、GIF 照片");
    if (typeof base64 !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return fail(400, "照片內容看不懂，請重新選一張");
    if (Math.floor((base64.length * 3) / 4) > MAX_PHOTO_BYTES) return fail(413, "照片太大了，請選 5 MB 以下的");

    const key = `${user.guildId}:${user.id}`;
    const now = Date.now();
    const last = lastUsed.get(key);
    if (last !== undefined && now - last < COOLDOWN_MS) return fail(429, `剛用過，${Math.ceil((COOLDOWN_MS - (now - last)) / 1000)} 秒後再試`);
    lastUsed.set(key, now);

    try {
        const features = await photoReader()({ mediaType, base64 });
        if (!features.person_found) return fail(422, "照片裡找不到看得清楚的人，換一張或手動選部件");
        res.send({ appearance: featuresToAppearance(features) });
    } catch (e) {
        if (e instanceof PhotoUnavailable) return fail(503, e.message);
        if (e instanceof PhotoRejected) return fail(422, e.message);
        console.error("照片生成角色失敗", e);
        fail(502, "暫時沒辦法用照片生成，請稍後再試或手動選部件");
    }
}

/** 測試用：清掉冷卻紀錄。 */
export const resetPhotoCooldown = () => lastUsed.clear();
