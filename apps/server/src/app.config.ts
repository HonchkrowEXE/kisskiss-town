import { defineServer, defineRoom, monitor, playground, JWT } from "colyseus";
import express from "express";
import { loginWithDiscord } from "./auth/discordLogin.js";

/**
 * Import your Room files
 */
import { MyRoom } from "./rooms/MyRoom.js";

export default defineServer({
  rooms: {
    town: defineRoom(MyRoom).filterBy(['guildId']),
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

      // 本機在一般瀏覽器測試用的假登入：要在 .env.development 明確打開才有效
      if (code === "mock_code" && process.env.ALLOW_MOCK_LOGIN === "true") {
        const id = Math.random().toString(36).slice(2, 10);
        const user = { id, name: `測試員 ${id}`, guildId };
        res.send({ access_token: "mocked", token: await JWT.sign(user), user });
        return;
      }

      try {
        const { accessToken, user } = await loginWithDiscord(code, guildId, {
          fetch,
          clientId: process.env.DISCORD_CLIENT_ID,
          clientSecret: process.env.DISCORD_CLIENT_SECRET,
        });
        res.send({ access_token: accessToken, token: await JWT.sign(user), user });
      } catch (e) {
        res.status(400).send({ error: e instanceof Error ? e.message : "登入失敗" });
      }
    });

    /**
     * Use @colyseus/playground and @colyseus/monitor
     * 只在開發環境開：正式環境經 URL Mapping 公開，任何人都能看到所有房間與玩家
     */
    if (process.env.NODE_ENV !== "production") {
      app.use("/", playground());
      app.use("/colyseus", monitor());
    }

    //
    // See more about the Authentication Module:
    // https://docs.colyseus.io/authentication/
    //
    // app.use(auth.prefix, auth.routes())
    //
  },
});
