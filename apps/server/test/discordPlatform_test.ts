import assert from "assert";
import { describeMessage, orderChannels, toVoiceMembers, type RawChannel, type RawVoiceState } from "../src/platform/discordPlatform.js";

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

describe("toVoiceMembers", () => {
    const state = (over: Partial<RawVoiceState>): RawVoiceState => ({
        userId: "1", displayName: "小明", channelId: "lobby",
        selfMute: false, serverMute: false, selfDeaf: false, serverDeaf: false, streaming: false, ...over,
    });

    it("自己靜音或被伺服器靜音都算靜音；拒聽也一樣", () => {
        const [a, b, c] = toVoiceMembers([state({ selfMute: true }), state({ serverMute: true }), state({ serverDeaf: true })]);
        assert.deepStrictEqual([a.muted, b.muted, c.deafened], [true, true, true]);
    });

    it("直播中照實帶過去", () => {
        assert.strictEqual(toVoiceMembers([state({ streaming: true })])[0].streaming, true);
    });

    it("不在語音頻道裡的略過", () => {
        assert.deepStrictEqual(toVoiceMembers([state({ channelId: null })]), []);
    });

    it("沒有名字時給一個看得懂的預設", () => {
        assert.strictEqual(toVoiceMembers([state({ displayName: null })])[0].name, "（沒有名字）");
    });
});

describe("describeMessage", () => {
    it("有文字就顯示文字；只有附件或嵌入內容時顯示說明", () => {
        assert.strictEqual(describeMessage({ content: "嗨", attachments: 1, embeds: 0 }), "嗨");
        assert.strictEqual(describeMessage({ content: "", attachments: 2, embeds: 0 }), "📎 附件");
        assert.strictEqual(describeMessage({ content: "", attachments: 0, embeds: 1 }), "（嵌入內容）");
    });
});
