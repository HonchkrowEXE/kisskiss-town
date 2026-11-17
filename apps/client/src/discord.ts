import { DiscordSDK, DiscordSDKMock } from "@discord/embedded-app-sdk";

export const DISCORD_CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID;

const params = new URLSearchParams(location.search);

// 在 DC 裡開啟時網址會帶 frame_id；本機用一般瀏覽器開沒有，改用模擬的 SDK
const isEmbedded = params.has("frame_id");

// 本機模擬：所有分頁預設在同一個伺服器（同一座小鎮）；網址加 ?guild_id=123 可以模擬別的伺服器
const mockGuildId = params.get("guild_id") ?? "1000000000000000001";

export const discordSDK = isEmbedded
  ? new DiscordSDK(DISCORD_CLIENT_ID)
  : new DiscordSDKMock(DISCORD_CLIENT_ID, mockGuildId, "mock-channel", null);