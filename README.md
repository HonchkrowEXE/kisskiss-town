# 親親小鎮 KissKiss Town

> An open-source, 2D pixel-art virtual town that runs inside Discord as an Activity. Walk your character into a room to join its voice channel, see who's talking or streaming, slap your friends, and play dice and card games with virtual chips.

在 Discord 裡逛一座像素小鎮。每個伺服器都有一座自己的小鎮，地圖上的每個房間對應一個 Discord 頻道：走進語音房就切到那個語音頻道，走進文字房就能看到並回覆那個頻道的訊息。

> 🚧 **規劃階段**：目前還沒有程式碼，這個 repo 先放規格和設計決策。想參與的話，從下面「參與開發」開始讀。

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

## 參與開發

完整流程（安裝 Matt skills、認領票、開 PR）見 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

1. 先讀 [`GLOSSARY.md`](GLOSSARY.md)：專案的名詞表，寫 issue、程式、文件時都用這裡定義的詞
2. 再讀 [`docs/adr/`](docs/adr/)：已經做過的設計決定和理由，想推翻某個決定時請先開 issue 討論
3. 到 [Issues](../../issues) 找標著 `ready-for-human` 或 `ready-for-agent` 的票
4. 用 AI coding agent 的話，規則在 [`AGENTS.md`](AGENTS.md)

## 授權

程式碼採用 [MIT](LICENSE)。

LPC 角色素材的授權和程式碼分開計算，每張圖可能是 CC0、CC-BY-SA、OGA-BY 或 GPL 等，使用時必須標註作者，遊戲內會有製作名單頁。
