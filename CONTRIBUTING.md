# 參與開發

親親小鎮用 [Matt Pocock 的 skills](https://github.com/mattpocock/skills) 規劃與開發：先把想法問清楚、寫成規格、拆成票，再一張一張用測試驅動的方式做。

## 1. 安裝 Matt skills（一次就好）

**Claude Code：**

```bash
claude plugins install mattpocock-skills
```

**Codex 或其他 agent：**

```bash
npx skills@latest add mattpocock/skills
```

不用跑 `/setup-matt-pocock-skills`：這個 repo 的設定已經放在 `docs/agents/` 了（issue 放 GitHub、五個預設標籤、名詞表在根目錄）。

## 2. 開工前先讀

1. [`GLOSSARY.md`](GLOSSARY.md)：名詞表。issue、程式、測試名稱都用這裡的詞
2. [`docs/adr/`](docs/adr/)：已經做過的決定和理由
3. [`AGENTS.md`](AGENTS.md)：給 AI agent 的規則，也是不能違反的限制

## 3. 做一張票

1. 到 [Issues](../../issues) 找標著 `ready-for-agent` 或 `ready-for-human` 的票，挑一張沒有被擋住（`Blocked by` 都已關閉）也沒人認領的
2. 把它指派給自己：`gh issue edit <編號> --add-assignee @me`
3. 從最新的 `main` 開分支：`git switch -c issue-<編號>-<簡短描述>`
4. 在 agent 裡跑 `/implement`，告訴它票的編號。它會用 TDD 一小步一小步做，最後跑 `/code-review` 自審
5. 推上去開 PR，內文寫 `Closes #<編號>`，合併時票會自動關閉

`main` 有保護，只能透過 PR 合併，不能直接推。

## 4. 有新想法或想改設計

- **新功能**：先開 issue 描述想法，或在 agent 裡跑 `/grill-with-docs` 把它問清楚，結論會寫進 `GLOSSARY.md` 和 `docs/adr/`
- **想推翻某個 ADR**：先開 issue 討論，不要直接改程式碼繞過它
- **回報 bug**：開 issue，會被標上 `needs-triage` 等維護者分類

## 5. 做完一件事之後

在同一個 session 跑 `/retro`，看看這次有沒有什麼該寫進規則、檢查或文件，讓下一個人更順。
