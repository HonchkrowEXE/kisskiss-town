import { Client } from "@colyseus/sdk";
import { login } from "./login.js";

const app = document.querySelector<HTMLDivElement>("#app")!;
const colyseus = new Client("/colyseus");

try {
  const { guildId, user } = await login(colyseus);
  const room = await colyseus.joinOrCreate("town", { guildId });
  app.textContent = `${user.name}，歡迎來到親親小鎮（房間 ${room.roomId}）`;
} catch (e) {
  console.error(e);
  app.textContent = `進不了小鎮：${e instanceof Error ? e.message : e}`;
}