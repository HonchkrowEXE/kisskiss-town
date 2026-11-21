import { Room, Client, CloseCode, JWT, ServerError } from "colyseus";
import type { TownUser } from "../auth/discordLogin.js";
import { ChipLedger } from "../chips/ChipLedger.js";
import { database } from "../db.js";
import { platform, PlatformUnavailable } from "../platform/platform.js";
import { layoutTown, roomAt, type ChannelRoom, type TownChannel, type TownLayout, type TownMapState } from "../town/layoutTown.js";
import { TownSettings } from "../town/TownSettings.js";
import { createWalkable, SPEED } from "../town/walkable.js";
import { AdminSettings } from "./features/AdminSettings.js";
import { Chips } from "./features/Chips.js";
import { GameTables } from "./features/GameTables.js";
import { Slapping } from "./features/Slapping.js";
import { TextRooms } from "./features/TextRooms.js";
import type { TownFeature } from "./features/TownFeature.js";
import { VoiceRooms } from "./features/VoiceRooms.js";
import { Wardrobe } from "./features/Wardrobe.js";
import { DIRECTIONS, TownState, Character, Vec2 } from "./schema/TownState.js";
import type { RoomChangeCause, Town } from "./Town.js";

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

export type MoveMessage = { x: number; y: number; dir: string };

/**
 * 一座小鎮（一個 Discord 伺服器）的遊戲房間。
 *
 * 這裡只管小鎮的骨架：登入、地圖（依頻道產生）、走動、記下每個人站在哪個房間。
 * 搧巴掌、遊戲桌、文字房這些功能各自是 features/ 底下的一個類別，
 * 這裡把前端訊息和事件（進出、換房間、地圖更新）分給它們。
 */
export class TownRoom extends Room<{
  state: TownState,
  metadata: { guildId: string }, // matchmaking filter, see app.config.ts
}> implements Town {
  state = new TownState();
  guildId = "";
  layout: TownLayout = layoutTown([]);
  walkable = createWalkable(this.layout.map);
  ledger = new ChipLedger(database());
  townSettings = new TownSettings(database());

  voiceRooms!: VoiceRooms;
  /** 小鎮的所有功能。加新功能就在 onCreate 的清單加一行。 */
  private features: TownFeature[] = [];

  /** 每位成員剩下的移動額度（budget）與上次結算的時間（at），key 是 sessionId。 */
  private moveMeters = new Map<string, { budget: number; at: number }>();
  /** 每位成員現在站在哪個房間（頻道 ID），key 是 sessionId。 */
  private currentRoom = new Map<string, string | undefined>();
  private stopWatching: () => void = () => {};
  private layoutVersion = 0;

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
    this.guildId = options.guildId;
    this.voiceRooms = new VoiceRooms(this);
    this.features = [
      new Chips(this),
      new Slapping(this),
      new Wardrobe(this),
      new GameTables(this),
      new TextRooms(this),
      this.voiceRooms,
      new AdminSettings(this),
    ];

    this.onMessage("move", (client, message: MoveMessage) => this.move(client, message));
    for (const feature of this.features) {
      for (const [type, handler] of Object.entries(feature.messages())) this.onMessage(type, handler);
    }

    // 先訂閱再讀，讀的這段時間裡發生的變動才不會漏掉
    this.stopWatching = platform().onChannelsChanged(this.guildId, () =>
      this.refreshLayout(this.guildId).catch((e) => console.error("更新小鎮地圖失敗", e)),
    );
    await this.refreshLayout(this.guildId);
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
    this.state.characters.forEach((character, sessionId) => {
      if (!this.walkable.canStand(character.position.x, character.position.y)) {
        const spawn = this.spawnPoint();
        character.position.x = spawn.x;
        character.position.y = spawn.y;
      }
      // 房間換了位置，重新記下每個人站在哪：沒有主動走進的房間不算「走進」，不會被搬
      this.placeIn(sessionId, roomAt(this.layout.rooms, character.position.x, character.position.y), "other");
    });

    for (const feature of this.features) await feature.onLayoutChanged();
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
      !character.seatedAt && // 坐在遊戲桌時不能走
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
    this.placeIn(client.sessionId, roomAt(this.layout.rooms, x, y), "walk");
  }

  // ── Town：給功能用的 ──────────────────────────────────────────

  clientOf(sessionId: string) {
    return this.clients.find((c) => c.sessionId === sessionId);
  }

  forEachCharacterOf(userId: string, change: (character: Character) => void) {
    for (const client of this.clients) {
      const character = this.state.characters.get(client.sessionId);
      if (character && client.auth.id === userId) change(character);
    }
  }

  roomOf(sessionId: string) {
    const id = this.currentRoom.get(sessionId);
    return this.layout.rooms.find((r) => r.id === id);
  }

  /** 記下成員現在站在哪個房間；換了房間才通知各個功能。 */
  placeIn(sessionId: string, room: ChannelRoom | undefined, cause: RoomChangeCause) {
    const before = this.currentRoom.get(sessionId);
    if (before === room?.id) return;
    this.currentRoom.set(sessionId, room?.id);
    const client = this.clientOf(sessionId);
    if (!client) return;
    for (const feature of this.features) feature.onRoomChanged(client, room, before, cause);
  }

  holdStill(sessionId: string) {
    const meter = this.moveMeters.get(sessionId);
    if (meter) Object.assign(meter, { budget: 0, at: this.clock.currentTime });
  }

  sendToAll(type: string, message: unknown) {
    this.broadcast(type, message);
  }

  // ── 成員進出 ──────────────────────────────────────────────────

  onJoin (client: Client, options: any) {
    console.log(client.sessionId, "joined!");
    this.state.characters.set(client.sessionId, new Character({
      userId: client.auth.id,
      name: client.auth.name,
      position: new Vec2(this.spawnPoint()),
      chips: 0,
    }));
    this.moveMeters.set(client.sessionId, { budget: MAX_MOVE_BUDGET, at: this.clock.currentTime });
    for (const feature of this.features) feature.onJoin(client);
  }

  onLeave (client: Client, code: CloseCode) {
    console.log(client.sessionId, "left!");
    for (const feature of this.features) feature.onLeave(client);
    this.state.characters.delete(client.sessionId);
    this.moveMeters.delete(client.sessionId);
    this.currentRoom.delete(client.sessionId);
  }

  onDispose() {
    this.stopWatching();
    for (const feature of this.features) feature.dispose();
    console.log("room", this.roomId, "disposing...");
  }
}
