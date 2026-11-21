import { readFileSync } from "node:fs";
import { Room, Client, CloseCode, JWT, ServerError } from "colyseus";
import type { TownUser } from "../auth/discordLogin.js";
import { createWalkable, SPEED, type TiledMap } from "../town/walkable.js";
import { DIRECTIONS, TownState, Player, Vec2 } from "./schema/TownState.js";

// ponytail: 每座小鎮都用前端內建的預設地圖；#5（匯入地圖）改成讀各伺服器自己的地圖
const DEFAULT_MAP: TiledMap = JSON.parse(
  readFileSync(new URL("../../../client/public/maps/town.json", import.meta.url), "utf8"),
);

/**
 * 一次最多能累積多遠的移動額度（像素）。額度每秒回復 SPEED，用來吸收網路延遲造成的訊息擠在一起，
 * 又不讓人連發訊息瞬移。
 */
const MAX_MOVE_BUDGET = 32;

export type MoveMessage = { x: number; y: number; dir: string };

export class TownRoom extends Room<{
  state: TownState,
  metadata: { guildId: string }, // matchmaking filter, see app.config.ts
}> {
  state = new TownState();
  walkable = createWalkable(DEFAULT_MAP);

  /** 每位成員剩下的移動額度與上次結算的時間，key 是 sessionId。 */
  private moveBudget = new Map<string, { budget: number; at: number }>();

  static async onAuth(token: string, options: { guildId?: string }) {
    const user = await JWT.verify<TownUser>(token);
    // guildId 是前端傳來的，不可信；要跟登入時向 DC 驗證過、簽進 JWT 的一致
    if (options.guildId !== user.guildId) {
      throw new ServerError(403, "不能進其他伺服器的小鎮");
    }
    return user;
  }

  onCreate (options: any) {
    this.onMessage("move", (client, message: MoveMessage) => this.move(client, message));
  }

  /** 前端算好的新位置。不合法就不採用，並把伺服器上的位置傳回去讓前端拉回來。 */
  private move(client: Client, message: MoveMessage) {
    const player = this.state.players.get(client.sessionId);
    const meter = this.moveBudget.get(client.sessionId);
    if (!player || !meter) return;

    const now = this.clock.currentTime;
    meter.budget = Math.min(MAX_MOVE_BUDGET, meter.budget + (SPEED * (now - meter.at)) / 1000);
    meter.at = now;

    const { x, y, dir } = message ?? ({} as MoveMessage);
    const distance = Math.hypot(x - player.position.x, y - player.position.y);
    const ok =
      DIRECTIONS.includes(dir as any) &&
      this.walkable.canStand(x, y) && // 也擋掉不是數字的座標
      distance <= meter.budget;

    if (!ok) {
      client.send("moveRejected", { x: player.position.x, y: player.position.y });
      return;
    }

    meter.budget -= distance;
    player.position.x = x;
    player.position.y = y;
    player.dir = dir;
  }

  onJoin (client: Client, options: any) {
    console.log(client.sessionId, "joined!");
    this.state.players.set(client.sessionId, new Player({
      name: client.auth.name,
      position: new Vec2(this.walkable.randomSpawn()),
    }));
    this.moveBudget.set(client.sessionId, { budget: MAX_MOVE_BUDGET, at: this.clock.currentTime });
  }

  onLeave (client: Client, code: CloseCode) {
    console.log(client.sessionId, "left!");
    this.state.players.delete(client.sessionId);
    this.moveBudget.delete(client.sessionId);
  }

  onDispose() {
    console.log("room", this.roomId, "disposing...");
  }

}
