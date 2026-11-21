import { defineServer, defineRoom, monitor, playground, JWT } from "colyseus";
import express, { type Request, type Response, type NextFunction } from "express";
import { loginWithDiscord, LoginError } from "./auth/discordLogin.js";

/**
 * Import your Room files
 */
import { TownRoom } from "./rooms/TownRoom.js";

/** 小鎮 token 的有效期限。每次打開 Activity 都會重新登入，所以不用太長。 */
const TOKEN_TTL = "12h";

/**
 * 請求是不是從外面經 Cloudflare（cloudflared 通道或 Discord 的代理）進來的。
 * Cloudflare 一定會加上 cf-ray 標頭；本機瀏覽器直連 Vite 或伺服器時不會有。
 */
const fromOutside = (req: Request) => req.headers["cf-ray"] !== undefined;

/** 開發工具只給本機用：經通道進來的請求一律擋掉。 */
function localOnly(req: Request, res: Response, next: NextFunction) {
  if (fromOutside(req)) res.status(403).send({ error: "開發工具只能在本機使用" });
  else next();
}

export default defineServer({
  rooms: {
    town: defineRoom(TownRoom).filterBy(['guildId']),
  },

  express: (app) => {
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
        if (process.env.ALLOW_MOCK_LOGIN !== "true" || fromOutside(req)) {
          res.status(403).send({ error: "假登入只能在本機、打開 ALLOW_MOCK_LOGIN 時使用" });
          return;
        }
        const id = Math.random().toString(36).slice(2, 10);
        const user = { id, name: `測試員 ${id}`, guildId };
        res.send({ access_token: "mocked", token: await JWT.sign(user, { expiresIn: TOKEN_TTL }), user });
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
        res.send({ access_token: accessToken, token: await JWT.sign(user, { expiresIn: TOKEN_TTL }), user });
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
      app.use("/", localOnly, playground());
      app.use("/colyseus", localOnly, monitor());
    }

    //
    // See more about the Authentication Module:
    // https://docs.colyseus.io/authentication/
    //
    // app.use(auth.prefix, auth.routes())
    //
  },
});
