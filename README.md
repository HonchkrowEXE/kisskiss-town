# 親親小鎮 KissKiss Town

> An open-source, 2D pixel-art virtual town that runs inside Discord as an Activity. Walk your character into a room to join its voice channel, see who's talking or streaming, slap your friends, and play dice and card games with virtual chips.

在 Discord 裡逛一座像素小鎮。每個伺服器都有一座自己的小鎮，地圖上的每個房間對應一個 Discord 頻道：走進語音房就切到那個語音頻道，走進文字房就能看到並回覆那個頻道的訊息。

> 🚧 **開發初期**：目前做到「在 Discord 裡打開，看到地圖和自己的名字」。想參與的話，從下面「參與開發」開始讀。

## 第一版要做什麼

| 功能 | 說明 |
|---|---|
| 🗺️ 小鎮地圖 | 管理員用 [tilemap.dev](https://tilemap.dev/) 或 [Tiled](https://www.mapeditor.org/) 畫地圖、匯入，在小鎮裡框房間、綁定頻道、放物件 |
| 🚪 房間 = 頻道 | 走進語音房，bot 就把你搬到對應的語音頻道；走進文字房，畫面旁會顯示訊息，也能直接回覆 |
| 🧍 角色 | 上傳照片，AI 判斷髮型、髮色、膚色、衣服等特徵，自動用像素部件組出你的角色，四個方向都有走路動畫 |
| 🔴 動態 | 角色頭上顯示誰正在說話、誰在直播，點一下就能過去 |
| 👋 搧巴掌 | 走到朋友旁邊搧下去，對方會被打退一格，Discord 也會收到通知（可以關掉「可被搧」） |
| 🎲 小遊戲 | 骰子比大小、21 點、吹牛，坐上地圖上的遊戲桌就能開局 |
| 🪙 籌碼 | 純虛擬貨幣：新人送 1000、每天簽到送 200、歸零可領救濟金。**不能用真錢買，也不能換成現金** |

**之後才做**：德州撲克、串接外部 bot 與 API（先串 honchkrow_bot）、Microsoft Teams 支援、照片審核。

## 技術組合

| 用途 | 套件 |
|---|---|
| 畫面 | [Phaser 4](https://phaser.io/)（原生支援 Tiled JSON 地圖） |
| 多人連線 | [Colyseus](https://colyseus.io/)，從官方 [Discord Activity 範本](https://github.com/colyseus/discord-activity) 起步 |
| 嵌入 Discord | [@discord/embedded-app-sdk](https://github.com/discord/embedded-app-sdk) |
| Bot | [discord.js](https://discord.js.org/) |
| 角色素材 | [Universal LPC Spritesheet](https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator) |
| 照片特徵判斷 | Claude API |

全部用 TypeScript。為什麼這樣選，見 [`docs/adr/`](docs/adr/)。

## 本機開發

需要 Node.js 22 以上。

```
apps/
  server/   遊戲伺服器（Colyseus），port 2567
  client/   Activity 前端（Vite + Phaser），port 5173
```

### 1. 安裝與設定

```bash
npm install
cp apps/server/.env.example apps/server/.env.development
cp apps/client/.env.example apps/client/.env
```

打開 `apps/server/.env.development`：

- `JWT_SECRET`：換成一串隨機字，例如 `node -e "console.log(crypto.randomUUID())"` 的輸出
- `ALLOW_MOCK_LOGIN`：改成 `true`，才能在一般瀏覽器測試（見下一步）

`DISCORD_CLIENT_ID`、`DISCORD_CLIENT_SECRET`、`VITE_DISCORD_CLIENT_ID` 要到「在 Discord 裡測試」才需要填。

### 2. 在一般瀏覽器測試（不用 Discord）

開兩個終端機：

```bash
npm run start:server
npm run start:client
```

打開 <http://localhost:5173>。不在 Discord 裡時，前端會改用模擬的 Discord SDK，伺服器用假登入給你一個「測試員」名字。

- 多開幾個分頁，會進到同一座小鎮
- 網址加 `?guild_id=123`，模擬另一個伺服器的小鎮
- 設好 bot（見下面「Discord 開發者後台設定」）後，網址加 `?guild_id=<bot 所在伺服器的 ID>`，小鎮會照那個伺服器的頻道長出房間。沒有 bot 的伺服器只有一塊廣場

### 3. 跑測試

```bash
npm test -w server
```

## 在 Discord 裡測試

每位開發者用自己的 Discord 應用程式測試，或請擁有者把你加進應用程式的 Team。開發中的 Activity 只有應用程式擁有者和 Team 成員看得到。

### Discord 開發者後台設定（一次就好）

到 [Discord Developer Portal](https://discord.com/developers/applications) 建一個應用程式，然後：

- [ ] **OAuth2 → Redirects**：填 `https://127.0.0.1`。只是佔位值，SDK 會自己處理授權後的跳轉
- [ ] **OAuth2**：複製 Client ID 和 Client Secret
  - Client ID 填進 `apps/server/.env.development` 的 `DISCORD_CLIENT_ID`，以及 `apps/client/.env` 的 `VITE_DISCORD_CLIENT_ID`
  - Client Secret 填進 `apps/server/.env.development` 的 `DISCORD_CLIENT_SECRET`。**不要 commit、不要貼到任何地方**
- [ ] **Activities → Settings**：Supported Platforms 勾你要測的平台。`Enable Activities` 要先有 URL Mapping 才能勾，留到下一節第一次測試時再勾
- [ ] **Bot**：按 Reset Token，把 token 填進 `apps/server/.env.development` 的 `DISCORD_BOT_TOKEN`。**不要 commit、不要貼到任何地方**。小鎮的房間是用 bot 讀頻道清單長出來的（ADR-0010）
- [ ] **OAuth2 → URL Generator**：Scopes 勾 `bot`，Bot Permissions 勾 `View Channels`、`Move Members`、`Send Messages`、`Read Message History`、`Manage Webhooks`（文字房用成員的名字發言）、`Manage Channels`（開一對一通話的臨時語音頻道），用產生的網址把 bot 加進測試伺服器。已經加過的 bot 可以直接在伺服器設定給 bot 的身分組加上「管理 Webhook」
- [ ] **Bot → Privileged Gateway Intents**（文字房要讀訊息內容才需要）：打開 `Message Content Intent`，再在 `apps/server/.env.development` 設 `DISCORD_MESSAGE_CONTENT=true`。兩個要一起：只設環境變數、沒打開開關的話 bot 會登不進去

Discord App 也要打開開發者模式：使用者設定 → 進階 → `開發者模式`。

### 每次測試

開三個終端機：

```bash
npm run start:server
npm run start:client
npm run cloudflared
```

1. 從 `cloudflared` 的輸出複製 `https://xxxx.trycloudflare.com` 網址
2. 到 **Activities → URL Mappings**，PREFIX `/` 的 TARGET 填這個網址（不含 `https://`）。這個網址每次重開 `cloudflared` 都會變，所以每次都要重填
   - 第一次測試：填完後回 **Activities → Settings** 勾 `Enable Activities`
3. 在 Discord 的測試伺服器進語音頻道，點火箭圖示打開 Activity 清單，選你的應用程式

只要一條 URL Mapping 就夠：伺服器的請求走 `/colyseus`，由 Vite 轉給本機的 2567。

經通道（Cloudflare）進來的請求不能用假登入，也看不到 Colyseus 的 playground 和 monitor，這些只給本機直連用。

步驟出處：Discord 官方的 [Building an Activity](https://discord.com/developers/docs/activities/building-an-activity) 和 [Local Development](https://discord.com/developers/docs/activities/development-guides/local-development)。

## 參與開發

完整流程（安裝 Matt skills、認領票、開 PR）見 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

1. 先讀 [`GLOSSARY.md`](GLOSSARY.md)：專案的名詞表，寫 issue、程式、文件時都用這裡定義的詞
2. 再讀 [`docs/adr/`](docs/adr/)：已經做過的設計決定和理由，想推翻某個決定時請先開 issue 討論
3. 到 [Issues](../../issues) 找標著 `ready-for-human` 或 `ready-for-agent` 的票
4. 用 AI coding agent 的話，規則在 [`AGENTS.md`](AGENTS.md)

### 程式怎麼分

```text
apps/server/src/
├── rooms/
│   ├── TownRoom.ts        一座小鎮的骨架：登入、地圖、走動、記下每個人在哪個房間，把事件分給各個功能
│   ├── Town.ts            功能能看到、能做的事（介面）
│   └── features/          每個功能一個類別，都繼承 TownFeature
│       ├── Chips.ts         籌碼：簽到、救濟金
│       ├── VoiceRooms.ts    語音房：語音裡的人站在房裡、走進去就搬頻道
│       ├── TextRooms.ts     文字房：看訊息、發言
│       ├── Furniture.ts     家具：椅子坐下、電腦揪團看板、電視看直播、管理員的家具編輯器
│       ├── Slapping.ts      搧巴掌
│       ├── GameTables.ts    遊戲桌：入座、管理員擺桌子，把動作交給桌上的遊戲
│       ├── tables/          每種遊戲一個類別，都繼承 TableGame（骰子比大小、21 點、吹牛）
│       └── AdminSettings.ts 管理員的設定
├── platform/              平台轉接層（ADR-0008）：遊戲邏輯只透過它碰 Discord
├── games/                 遊戲規則，純邏輯（輸入狀態和動作，輸出新狀態）
├── town/                  地圖版面、碰撞、找路、站位等純函式
└── chips/                 籌碼帳本（ADR-0005）

apps/client/src/
├── main.ts                把下面的東西組起來
├── scene/                 Phaser 裡畫的東西
│   ├── TownScene.ts         場景：把下面三個接起來
│   ├── MapView.ts           地圖、房間名稱、遊戲桌、直播中標示
│   ├── CharacterLayer.ts    所有人的角色、語音裡的人、搧巴掌動畫
│   └── PlayerController.ts  鍵盤、搖桿、點地圖走路（找路在 town/path.ts），跟伺服器同步位置
└── ui/                    浮在地圖上的網頁元素（每個一個類別，建構時接上房間）
```

伺服器回給前端的「結果」訊息（例如 `slapResult`）要顯示成畫面上方的提示的話，加進 `ui/Toast.ts` 的清單。

**加一種家具：** `town/objects.ts` 的 `OBJECT_KINDS` 加一筆（名稱、大小、擋不擋路、怎麼互動）→ 前端 `scene/objectArt.ts` 加畫法 → 有自己的互動畫面的話，伺服器 `Furniture.ts` 加處理、前端 `ui/FurniturePanel.ts` 的 `VIEWS` 加一個類別。編輯器的按鈕會自動多一個。

**加一種遊戲桌上的遊戲：** 規則寫成 `games/` 底下的純邏輯模組並測試 → 伺服器寫一個繼承 `TableGame` 的類別（`rooms/features/tables/`）→ `town/tables.ts` 的 `GAME_KINDS` 加一種、`GameTables.createGame` 加一行 → 前端在 `ui/tables/` 寫一個繼承 `GamePanel` 的面板、`TablePanel` 的 `PANELS` 加一行。

**加一個新功能：**

1. 在 `rooms/features/` 寫一個類別繼承 `TownFeature`
2. `messages()` 列出它處理的前端訊息；需要的話覆寫 `onJoin`、`onLeave`、`onRoomChanged`、`onLayoutChanged`
3. 在 `TownRoom.onCreate` 的 `features` 清單加一行
4. 要碰 Discord 的話，先在 `platform/platform.ts` 的 `Platform` 加方法，再實作在 `discordPlatform.ts`，測試用的 `test/fakePlatform.ts` 也要加
5. 在 `test/TownRoom_test.ts` 用真的房間測（`npm test -w server`）

## 授權

程式碼採用 [MIT](LICENSE)。

LPC 角色素材的授權和程式碼分開計算，每張圖可能是 CC0、CC-BY-SA、OGA-BY 或 GPL 等，使用時必須標註作者，遊戲內會有製作名單頁。
