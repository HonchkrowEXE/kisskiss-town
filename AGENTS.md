# AGENTS.md

給 AI coding agent（Claude Code、Codex 等）讀的專案規則。

跟擁有者對話一律用繁體中文。

改既有設計、做新功能前，先讀 `GLOSSARY.md` 與 `docs/adr/`，看有沒有已經決定過的。

## 不能違反的限制

- **Discord Activity 不支援 WebRTC**，所有網路請求都要走 Discord 的 URL Mapping 代理。即時連線只用 WebSocket。見 ADR-0003。
- **籌碼是純虛擬的**：不能用真錢買、不能換成現金、不能用任何付費方式取得。見 ADR-0005。
- **LPC 素材要標作者**：用到的每個部件都要出現在遊戲內的製作名單。見 ADR-0007。
- **遊戲邏輯不直接呼叫 Discord**，一律經過平台轉接層。見 ADR-0008。

## Agent skills

### Issue tracker

Issue 與規格放在 GitHub Issues，用 `gh` CLI 操作。見 `docs/agents/issue-tracker.md`。

### Triage labels

使用預設的五個標籤（`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`）。見 `docs/agents/triage-labels.md`。

### Domain docs

Single-context：根目錄一份 `GLOSSARY.md`，決策在 `docs/adr/`。見 `docs/agents/domain.md`。
