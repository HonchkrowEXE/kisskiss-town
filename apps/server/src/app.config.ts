import { defineServer, defineRoom, monitor, playground, JWT } from "colyseus";
import express, { type Request, type RequestHandler } from "express";
import { loginWithDiscord, LoginError, type TownUser } from "./auth/discordLogin.js";
import { photoLookRoute } from "./characters/photoRoute.js";
import { townMapRoute } from "./town/mapRoute.js";

/**
 * Import your Room files
 */
import { TownRoom } from "./rooms/TownRoom.js";

/**
 * 請求是不是本機直連（瀏覽器 → Vite → 伺服器，或直接打伺服器）。預設當成外面來的，三個條件都符合才算本機：
 * - 連線來自 127.0.0.1／::1（擋區網直連）
 * - 沒有 cf-ray：Cloudflare（cloudflared 通道、Discord 代理）一定會加，但經 Vite 轉發後來源也是 127.0.0.1
 * - 沒有 x-forwarded-for：ngrok 這類通道和一般反向代理會加；Vite 的 proxy 預設不加
 * ponytail: 正式環境要設 NODE_ENV=production，開發工具才完全不掛上去；部署那張票要記得
 */
export function isLocalRequest(req: Request) {
  const ip = req.socket.remoteAddress ?? "";
  const loopback = ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
  return loopback && req.headers["cf-ray"] === undefined && req.headers["x-forwarded-for"] === undefined;
}

/** 開發工具只給本機用；外面來的請求當作它不存在，交給後面的路由（最後是 404）。 */
const localOnly = (handler: RequestHandler): RequestHandler => (req, res, next) =>
  isLocalRequest(req) ? handler(req, res, next) : next();

/** 簽發小鎮 token。每次打開 Activity 都會重新登入，所以期限不用太長。 */
const signTownToken = (user: TownUser) => JWT.sign(user, { expiresIn: "12h" });

export default defineServer({
  rooms: {
    town: defineRoom(TownRoom).filterBy(['guildId']),
  },

  express: (app) => {
    // 照片要比預設的 100 KB 大，所以這條路由用自己的解析器，放在全域的前面
    app.post("/photo_look", express.json({ limit: "8mb" }), photoLookRoute);
    app.post("/town_map", express.json({ limit: "8mb" }), townMapRoute);
    app.use(express.json());

    /**
     * Bind your custom express routes here:
     * Read more: https://expressjs.com/en/starter/basic-routing.html
     */
    app.get("/hello_world", (req, res) => {
      res.send("It's time to kick ass and chew bubblegum!");
    });

    //
    // Discord Embedded SDK: Retrieve user token when under Discord/Embed
    //
    app.post('/discord_token', async (req, res) => {
      const { code, guildId } = req.body ?? {};
      if (typeof code !== "string" || typeof guildId !== "string") {
        res.status(400).send({ error: "缺少 code 或 guildId" });
        return;
      }

      // 本機在一般瀏覽器測試用的假登入：要在 .env.development 明確打開，而且只接受本機直連的請求
      if (code === "mock_code") {
        if (process.env.ALLOW_MOCK_LOGIN !== "true" || !isLocalRequest(req)) {
          res.status(403).send({ error: "假登入只能在本機、打開 ALLOW_MOCK_LOGIN 時使用" });
          return;
        }
        const id = Math.random().toString(36).slice(2, 10);
        const user = { id, name: `測試員 ${id}`, guildId };
        res.send({ access_token: "mocked", token: await signTownToken(user), user });
        return;
      }

      const clientId = process.env.DISCORD_CLIENT_ID;
      const clientSecret = process.env.DISCORD_CLIENT_SECRET;
      const missing = [!clientId && "DISCORD_CLIENT_ID", !clientSecret && "DISCORD_CLIENT_SECRET"].filter(Boolean);
      if (missing.length) {
        res.status(500).send({ error: `伺服器沒有設定 ${missing.join("、")}` });
        return;
      }

      try {
        const { accessToken, user } = await loginWithDiscord(code, guildId, { fetch, clientId, clientSecret });
        res.send({ access_token: accessToken, token: await signTownToken(user), user });
      } catch (e) {
        if (e instanceof LoginError) {
          res.status(400).send({ error: e.message });
        } else {
          // 網路斷線、DC 回了奇怪的東西、JWT_SECRET 沒設之類：是伺服器的問題，細節只留在伺服器 log
          console.error("/discord_token 失敗", e);
          res.status(500).send({ error: "伺服器登入時發生錯誤" });
        }
      }
    });

    /**
     * Use @colyseus/playground and @colyseus/monitor
     * 只在開發環境、而且只給本機用：經通道或正式環境公開的話，任何人都能看到所有小鎮的成員
     */
    if (process.env.NODE_ENV !== "production") {
      app.use("/", localOnly(playground()));
      app.use("/colyseus", localOnly(monitor()));
    }

    //
    // See more about the Authentication Module:
    // https://docs.colyseus.io/authentication/
    //
    // app.use(auth.prefix, auth.routes())
    //
  },
});
