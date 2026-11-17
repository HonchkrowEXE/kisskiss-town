import { Room, Client, CloseCode, JWT, ServerError } from "colyseus";
import type { TownUser } from "../auth/discordLogin.js";
import { MyRoomState, Player, Vec2 } from "./schema/MyRoomState.js";

export class MyRoom extends Room<{
  state: MyRoomState,
  metadata: { guildId: string }, // matchmaking filter, see app.config.ts
}> {
  state = new MyRoomState();

  static async onAuth(token: string, options: { guildId?: string }) {
    const user = await JWT.verify<TownUser>(token);
    // guildId 是前端傳來的，不可信；要跟登入時向 DC 驗證過、簽進 JWT 的一致
    if (options.guildId !== user.guildId) {
      throw new ServerError(403, "不能進其他伺服器的小鎮");
    }
    return user;
  }

  onCreate (options: any) {
    this.onMessage("move", (client, message) => {
      const player = this.state.players.get(client.sessionId);
      player.position.x = message.x;
      player.position.y = message.y;
    });
  }

  onJoin (client: Client, options: any) {
    console.log(client.sessionId, "joined!");
    this.state.players.set(client.sessionId, new Player({
      name: client.auth.name,
      heroType: Math.floor(Math.random() * 12) + 1,
      position: new Vec2({
        x: Math.floor(Math.random() * 100),
        y: Math.floor(Math.random() * 100),
      }),
    }));
  }

  onLeave (client: Client, code: CloseCode) {
    console.log(client.sessionId, "left!");
    this.state.players.delete(client.sessionId);
  }

  onDispose() {
    console.log("room", this.roomId, "disposing...");
  }

}
