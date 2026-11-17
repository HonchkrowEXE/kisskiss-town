import type { Client } from "@colyseus/sdk";
import { DISCORD_CLIENT_ID, discordSDK } from "./discord.js";

export async function login(colyseus: Client) {
    await discordSDK.ready();

    // 私訊或群組私訊裡開啟時沒有伺服器 ID
    const guildId = discordSDK.guildId;
    if (!guildId) throw new Error("親親小鎮只能在伺服器裡開啟");

    // 1. 跳出 DC 授權視窗，拿到一次性的授權碼
    const { code } = await discordSDK.commands.authorize({
        client_id: DISCORD_CLIENT_ID,
        response_type: "code",
        state: "",
        prompt: "none",
        scope: ["identify", "guilds.members.read"],
    });

    // 2. 授權碼交給我們的伺服器，換成 DC 的 access token 和小鎮的 JWT
    const { data } = await colyseus.http.post("/discord_token", { body: { code, guildId } });

    // 3. 用 access token 讓 SDK 登入，之後才能用需要身分的指令（例如讀說話中狀態）
    await discordSDK.commands.authenticate({ access_token: data.access_token });

    // 之後連房間時，SDK 會把這個 JWT 送給伺服器的 onAuth
    colyseus.auth.token = data.token;
    return { guildId, user: data.user };
}