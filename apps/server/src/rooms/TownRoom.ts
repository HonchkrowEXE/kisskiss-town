import { Room, Client, CloseCode, JWT, ServerError } from "colyseus";
import type { TownUser } from "../auth/discordLogin.js";
import { createWalkable, SPEED } from "../town/walkable.js";
import { layoutTown, type TownChannel, type TownLayout, type TownMapState } from "../town/layoutTown.js";
import { platform, PlatformUnavailable, type VoiceMember } from "../platform/platform.js";
import { ChipLedger, ChipError, type ChipOwner } from "../chips/ChipLedger.js";
import { database } from "../db.js";
import { DIRECTIONS, TownState, Character, Vec2, VoiceFigure } from "./schema/TownState.js";
import { placeVoiceFigures } from "../town/placeVoiceFigures.js";

/**
 * 一次最多能累積多遠的移動額度（像素）。額度每秒回復 SPEED，用來吸收網路延遲造成的訊息擠在一起，
 * 又不讓人連發訊息瞬移。
 */
const MAX_MOVE_BUDGET = 32;

/** jsonwebtoken 對「token 本身有問題」丟的錯誤；secret 沒設也是 JsonWebTokenError，要另外排除。 */
const isBadToken = (e: unknown) =>
  e instanceof Error &&
  ["JsonWebTokenError", "TokenExpiredError", "NotBeforeError"].includes(e.name) &&
  !/secret/i.test(e.message);

/** 籌碼帳本用的成員身分：登入時驗證過、簽進 JWT 的伺服器和帳號。 */
const chipOwnerOf = (client: Client): ChipOwner => ({ guildId: client.auth.guildId, userId: client.auth.id });

export type MoveMessage = { x: number; y: number; dir: string };

export class TownRoom extends Room<{
  state: TownState,
  metadata: { guildId: string }, // matchmaking filter, see app.config.ts
}> {
  state = new TownState();
  layout: TownLayout = layoutTown([]);
  walkable = createWalkable(this.layout.map);
  ledger = new ChipLedger(database());

  /** 每位成員剩下的移動額度（budget）與上次結算的時間（at），key 是 sessionId。 */
  private moveMeters = new Map<string, { budget: number; at: number }>();
  private stopWatching: (() => void)[] = [];
  private layoutVersion = 0;
  private voiceVersion = 0;

  static async onAuth(token: string, options: { guildId?: string }) {
    // 驗證失敗時 Colyseus 預設回 523，經 Cloudflare 會被換成它自己的錯誤頁、訊息消失，所以改回 401
    const user = await JWT.verify<TownUser>(token).catch((e) => {
      // 只有 token 本身壞掉或過期才算使用者的問題；JWT_SECRET 沒設之類的伺服器問題照原樣往外丟
      if (isBadToken(e)) throw new ServerError(401, "登入已失效，請重新打開親親小鎮");
      throw e;
    });
    // guildId 是前端傳來的，不可信；要跟登入時向 DC 驗證過、簽進 JWT 的一致
    if (options.guildId !== user.guildId) {
      throw new ServerError(403, "不能進其他伺服器的小鎮");
    }
    return user;
  }

  async onCreate (options: { guildId: string }) {
    this.onMessage("move", (client, message: MoveMessage) => this.move(client, message));
    this.onMessage("checkIn", (client) => this.changeChips(client, (owner) => this.ledger.checkIn(owner), "簽到成功"));
    this.onMessage("claimRelief", (client) => this.changeChips(client, (owner) => this.ledger.claimRelief(owner), "領到救濟金"));

    // 先訂閱再讀，讀的這段時間裡發生的變動才不會漏掉
    const refresh = () => this.refreshLayout(options.guildId).catch((e) => console.error("更新小鎮地圖失敗", e));
    const refreshVoice = () => this.refreshVoice(options.guildId).catch((e) => console.error("更新語音狀態失敗", e));
    this.stopWatching = [
      platform().onChannelsChanged(options.guildId, refresh),
      platform().onVoiceChanged(options.guildId, refreshVoice),
    ];
    await this.refreshLayout(options.guildId);
  }

  /** 依目前語音頻道裡的人，更新站在語音房裡的成員。 */
  async refreshVoice(guildId: string) {
    const version = ++this.voiceVersion;
    let members: VoiceMember[] = [];
    try {
      members = await platform().voiceMembers(guildId);
    } catch (e) {
      if (!(e instanceof PlatformUnavailable)) throw e;
      console.warn("讀不到語音狀態：", e.message);
      return; // 暫時連不上就保留原本的樣子，不要讓語音房裡的人整批消失
    }
    if (version !== this.voiceVersion) return;

    const placed = placeVoiceFigures(this.layout.rooms, members);
    const present = new Set(placed.map((p) => p.userId));
    this.state.voice.forEach((_figure, userId) => {
      if (!present.has(userId)) this.state.voice.delete(userId);
    });
    for (const { userId, ...figure } of placed) {
      const existing = this.state.voice.get(userId);
      if (existing) Object.assign(existing, figure);
      else this.state.voice.set(userId, new VoiceFigure(figure));
    }
  }

  /** 依目前的頻道清單重畫小鎮；站在新牆裡的角色送回廣場。 */
  async refreshLayout(guildId: string) {
    // 頻道事件連續來時會同時讀好幾次；只採用最後一次發出的，晚回來的舊結果不能蓋掉新的
    const version = ++this.layoutVersion;
    let channels: TownChannel[] = [];
    let notice: string | null = null;
    try {
      const found = await platform().channels(guildId);
      if (found) channels = found;
      else notice = "這個伺服器還沒加入親親小鎮的 bot，請管理員邀請；邀請後小鎮會自動更新";
    } catch (e) {
      if (!(e instanceof PlatformUnavailable)) throw e;
      console.warn("讀不到頻道：", e.message);
      notice = "暫時讀不到 Discord 的頻道，小鎮先只顯示廣場";
    }
    if (version !== this.layoutVersion) return;

    this.layout = layoutTown(channels);
    this.walkable = createWalkable(this.layout.map);
    const map: TownMapState = { ...this.layout, notice };
    this.state.map = JSON.stringify(map);

    // 先把站在新牆裡的角色送回廣場，跟新地圖在同一次同步送出
    this.state.characters.forEach((character) => {
      if (this.walkable.canStand(character.position.x, character.position.y)) return;
      const spawn = this.spawnPoint();
      character.position.x = spawn.x;
      character.position.y = spawn.y;
    });

    // 房間位置變了，語音房裡的人也要重新站位；失敗不影響地圖
    await this.refreshVoice(guildId).catch((e) => console.error("更新語音狀態失敗", e));
  }

  /** 廣場出生點附近隨機一格，避免大家疊在同一點。 */
  private spawnPoint() {
    const { spawn, map } = this.layout;
    const dx = (Math.floor(Math.random() * 5) - 2) * map.tilewidth;
    const candidate = { x: spawn.x + dx, y: spawn.y };
    return this.walkable.canStand(candidate.x, candidate.y) ? candidate : { ...spawn };
  }

  /** 前端算好的新位置。不合法就不採用，並把伺服器上的位置傳回去讓前端拉回來。 */
  private move(client: Client, message: MoveMessage) {
    const character = this.state.characters.get(client.sessionId);
    const meter = this.moveMeters.get(client.sessionId);
    if (!character || !meter) return;

    const now = this.clock.currentTime;
    meter.budget = Math.min(MAX_MOVE_BUDGET, meter.budget + (SPEED * (now - meter.at)) / 1000);
    meter.at = now;

    const { x, y, dir } = message ?? ({} as MoveMessage);
    const distance = Math.hypot(x - character.position.x, y - character.position.y);
    const ok =
      DIRECTIONS.includes(dir as any) &&
      distance <= meter.budget && // NaN 比大小一律是 false，也擋掉不是數字的座標
      this.walkable.canWalk(character.position, { x, y });

    if (!ok) {
      client.send("moveRejected", { x: character.position.x, y: character.position.y, dir: character.dir });
      return;
    }

    meter.budget -= distance;
    character.position.x = x;
    character.position.y = y;
    character.dir = dir;
  }

  /**
   * 經籌碼帳本改餘額，結果（成功或被拒的原因）傳回給那位成員。
   * 同一位成員可能開了好幾個分頁，每個分頁的角色都要更新成新餘額。
   */
  private changeChips(client: Client, action: (owner: ChipOwner) => number, okMessage: string) {
    try {
      const balance = action(chipOwnerOf(client));
      for (const other of this.clients) {
        const character = this.state.characters.get(other.sessionId);
        if (character && other.auth.id === client.auth.id) character.chips = balance;
      }
      client.send("chipResult", { ok: true, message: okMessage });
    } catch (e) {
      if (!(e instanceof ChipError)) throw e;
      client.send("chipResult", { ok: false, message: e.message });
    }
  }

  onJoin (client: Client, options: any) {
    console.log(client.sessionId, "joined!");
    this.state.characters.set(client.sessionId, new Character({
      userId: client.auth.id,
      name: client.auth.name,
      position: new Vec2(this.spawnPoint()),
      chips: this.ledger.welcome(chipOwnerOf(client)),
    }));
    this.moveMeters.set(client.sessionId, { budget: MAX_MOVE_BUDGET, at: this.clock.currentTime });
  }

  onLeave (client: Client, code: CloseCode) {
    console.log(client.sessionId, "left!");
    this.state.characters.delete(client.sessionId);
    this.moveMeters.delete(client.sessionId);
  }

  onDispose() {
    for (const stop of this.stopWatching) stop();
    console.log("room", this.roomId, "disposing...");
  }

}
