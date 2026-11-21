# 地圖從 tilemap.dev／Tiled 匯入，Activity 裡只框房間、放物件

第一版不自己寫圖塊編輯器。管理員用 tilemap.dev 畫好地圖、匯出成 Tiled JSON 再上傳。Activity 裡的編輯模式只負責框房間、綁定頻道、放物件。tilemap.dev 本身不能標示區域或加自訂屬性，所以房間資料由我們自己的編輯模式寫進 Tiled 物件層（物件 class 為 `area`，加上頻道屬性），這樣用 Tiled 打開也看得到。

> 2026-11-21：第一版改成小鎮從頻道清單自動長出來（ADR-0010），匯入地圖延後，之後當成覆蓋自動版的選項。
