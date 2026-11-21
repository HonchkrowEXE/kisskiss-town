import assert from "assert";
import { orderChannels, type RawChannel } from "../src/platform/discordPlatform.js";

const ch = (id: string, kind: "voice" | "text", position: number, categoryPosition: number | null): RawChannel =>
    ({ id, name: id, kind, position, categoryPosition });

describe("orderChannels", () => {
    it("照 Discord 側邊欄的順序：沒分類的在最上面，再依分類順序", () => {
        const ordered = orderChannels([
            ch("遊戲語音", "voice", 0, 2),
            ch("閒聊", "text", 0, 1),
            ch("公告", "text", 0, null),
            ch("大廳", "voice", 0, 1),
        ]);

        assert.deepStrictEqual(ordered.map((c) => c.id), ["公告", "閒聊", "大廳", "遊戲語音"]);
    });

    it("同一個分類裡文字頻道在語音頻道上面，再依位置", () => {
        const ordered = orderChannels([
            ch("語音2", "voice", 1, 0),
            ch("文字2", "text", 3, 0),
            ch("語音1", "voice", 0, 0),
            ch("文字1", "text", 2, 0),
        ]);

        assert.deepStrictEqual(ordered.map((c) => c.id), ["文字1", "文字2", "語音1", "語音2"]);
    });

    it("輸出只留小鎮需要的欄位", () => {
        assert.deepStrictEqual(orderChannels([ch("a", "text", 0, null)]), [{ id: "a", name: "a", kind: "text" }]);
    });
});
