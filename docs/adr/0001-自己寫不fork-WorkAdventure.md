# 自己寫，不 fork WorkAdventure

WorkAdventure 是最接近的開源專案，但不拿來當基底。原因有三：它的授權是 AGPL-3.0 加 Commons Clause（`play/LICENSE.txt`），會擋住未來可能的收費；它的核心功能（WebRTC 距離語音和視訊）在 Discord Activity 裡用不了；專案很大（自架要 6 個以上的服務、約 2,700 個程式檔），拆掉用不到的部分比自己寫還費工。

可以借它的設計想法（房間用 Tiled 物件層標示、地圖內編輯器只放物件和框區域），但不複製它的程式碼。
