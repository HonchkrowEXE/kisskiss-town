# 全部用 TypeScript，Phaser + Colyseus，從官方範本起步

前端、遊戲伺服器、bot 都用 TypeScript：Phaser（畫面）、Colyseus（多人連線伺服器）、@discord/embedded-app-sdk、discord.js，授權都是 MIT 或 Apache-2.0。專案從 Colyseus 官方的 Discord Activity 範本（github.com/colyseus/discord-activity）起步，那份範本已經示範了 WebSocket 怎麼通過 Discord 的代理。

## Considered Options

- **後端和 bot 用 Python**：Colyseus 沒有 Python 伺服器，它的通訊協定也沒有完整規格，所以配對、斷線重連、狀態同步都得自己重寫，估計多花 2–3 週。前後端還要用兩種語言各寫一份型別。因此不採用。
