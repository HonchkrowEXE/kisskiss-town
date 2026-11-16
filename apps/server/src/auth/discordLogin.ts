const DISCORD_API = "https://discord.com/api";

export type TownUser = { 
    id: string; 
    name: string; 
    guildId: string 
};

export type LoginDeps = {
    fetch: typeof globalThis.fetch;
    clientId: string;
    clientSecret: string;
};

export class LoginError extends Error {}

export async function loginWithDiscord(code: string, guildId: string, deps: LoginDeps) {
    // 伺服器 ID 是前端傳來的，只接受純數字（DC 的 ID 格式），也擋掉 "../" 這類路徑
    if (!/^\d+$/.test(guildId)) throw new LoginError("親親小鎮只能在伺服器裡開啟");

    // 1. 用授權碼換 access token
    const tokenRes = await deps.fetch(`${DISCORD_API}/oauth2/token`, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
            client_id: deps.clientId,
            client_secret: deps.clientSecret,
            grant_type: "authorization_code",
            code,
        }),
    });

    if (!tokenRes.ok) throw new LoginError(`DC 拒絕授權碼（${tokenRes.status}）`);

    const { access_token: accessToken } = await tokenRes.json();

    const auth = { headers: { Authorization: `Bearer ${accessToken}` } };

    // 2. 取得帳號資料
    const meRes = await deps.fetch(`${DISCORD_API}/users/@me`, auth);
    if (!meRes.ok) throw new LoginError(`讀不到帳號資料（${meRes.status}）`);
    const me = await meRes.json();

    // 3. 確認是這個伺服器的成員，順便拿伺服器暱稱
    const memberRes = await deps.fetch(`${DISCORD_API}/users/@me/guilds/${guildId}/member`, auth);
    if (!memberRes.ok) throw new LoginError(`不是這個伺服器的成員（${memberRes.status}）`);
    const member = await memberRes.json();

    const user: TownUser = {
        id: me.id,
        name: member.nick ?? me.global_name ?? me.username,
        guildId,
    };
    return { accessToken, user };
}
