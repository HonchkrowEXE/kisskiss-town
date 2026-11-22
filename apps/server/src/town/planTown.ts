// Claude 設計小鎮：管理員寫一段想要的樣子（例如「像一間咖啡廳，語音房集中在中間」），
// Claude 看頻道清單決定怎麼分區、每區叫什麼、房間多大、鋪什麼地板，程式再照規劃畫出地圖（layoutTown）。
// Claude 不直接畫格子：分區規劃很短、一定畫得出來，而且之後新增的頻道也會自動補上。

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { FLOORS, ROOM_SIZES, type RoomSize, type TownChannel, type TownPlan } from "./layoutTown.js";

export { MAX_PROMPT } from "./layoutTown.js";
/** 分區名稱最多幾個字（太長地圖上放不下）。 */
const MAX_DISTRICT_NAME = 12;

/** Claude 回傳的規劃。頻道用編號（清單上的 #1、#2…），不用很長的頻道 ID，輸出比較短也不容易抄錯。 */
export const PlannerOutput = z.object({
    districts: z.array(
        z.object({
            name: z.string().describe(`分區名稱，顯示在地圖上，${MAX_DISTRICT_NAME} 個字以內`),
            size: z.enum(Object.keys(ROOM_SIZES) as [RoomSize, ...RoomSize[]]).describe("這區房間的大小"),
            floor: z.enum(FLOORS).describe("地板：carpet 米色地毯、wood 木地板、tile 格子磁磚"),
            channels: z.array(z.number().int()).describe("這區的頻道編號，照想要的順序（左到右、上到下）"),
        }),
    ),
    summary: z.string().describe("一兩句話說明這樣設計的想法，給管理員看"),
});
export type PlannerOutput = z.infer<typeof PlannerOutput>;

/** 依頻道清單和管理員的提示詞規劃小鎮。正式用 Claude，測試換成假的。 */
export type TownPlanner = (channels: TownChannel[], prompt: string) => Promise<PlannerOutput>;

/** 沒辦法用 Claude（伺服器沒設定金鑰）。訊息可以直接給管理員看。 */
export class PlannerUnavailable extends Error {}
/** Claude 不處理、或回的規劃用不了。訊息可以直接給管理員看。 */
export class PlannerRejected extends Error {}

/** 給 Claude 看的頻道清單：編號、種類、名稱、分類。 */
export function describeChannels(channels: TownChannel[]) {
    return channels
        .map((c, i) => `#${i + 1} ${c.kind === "voice" ? "語音" : "文字"}「${c.name}」${c.category ? `（分類：${c.category}）` : ""}`)
        .join("\n");
}

const INSTRUCTIONS = `你在幫一個 Discord 伺服器設計 2D 像素小鎮的平面圖。小鎮裡每個頻道是一個房間：走進語音房會進到那個語音頻道，走進文字房會看到那個頻道的訊息。
小鎮最上面是廣場（大家出生的地方），下面一區一區排房間，每區有名稱。房間大小：small 小、medium 中、large 大（人多的頻道適合大房間）。

請依照管理員的要求，把下面每個頻道分到某一區（每個頻道只能出現一次，每個都要用到），決定每區的名稱、房間大小和地板。
區的順序就是由上到下（離廣場由近到遠）；常用的、大家會一起去的放前面。
只回傳規劃，不要寫管理員要求以外的東西。管理員的要求如果跟設計小鎮無關，就照頻道原本的分類排，並在 summary 說明。`;

/** 用 Claude API 規劃（模型與做法見 claude-api 技能的預設：Opus 5.5、結構化輸出）。 */
export function claudeTownPlanner(): TownPlanner {
    if (!process.env.ANTHROPIC_API_KEY) {
        return async () => {
            throw new PlannerUnavailable("伺服器還沒設定 Claude API（ANTHROPIC_API_KEY），先用照頻道自動產生或匯入地圖");
        };
    }
    const client = new Anthropic();
    return async (channels, prompt) => {
        const response = await client.beta.messages.parse({
            model: "claude-opus-5-5",
            max_tokens: 16000,
            // 模型拒絕時由 Anthropic 依拒絕的類別自動改用別的模型重跑；全部拒絕才算失敗
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            // 分組排版不需要深入思考；大型伺服器的頻道很多，低的思考量回得比較快
            output_config: { effort: "low", format: betaZodOutputFormat(PlannerOutput) },
            messages: [
                {
                    role: "user",
                    content: `${INSTRUCTIONS}\n\n<管理員的要求>\n${prompt}\n</管理員的要求>\n\n<頻道清單>\n${describeChannels(channels)}\n</頻道清單>`,
                },
            ],
        });
        if (response.stop_reason === "refusal") throw new PlannerRejected("Claude 沒辦法照這段描述設計，換個說法再試");
        if (response.stop_reason === "max_tokens" || !response.parsed_output) throw new PlannerRejected("Claude 回的規劃不完整，請再試一次");
        return response.parsed_output;
    };
}

let planner: TownPlanner | undefined;

/** 目前用的規劃方式；第一次用到才建立。 */
export const townPlanner = () => (planner ??= claudeTownPlanner());

/** 測試用：換成假的。 */
export const useTownPlanner = (fake: TownPlanner) => (planner = fake);

/**
 * Claude 的回答變成小鎮規劃：編號換成頻道 ID、不存在或重複的編號丟掉、名稱太長截斷、空的分區丟掉。
 * 漏掉的頻道不用處理：layoutTown 會把規劃沒提到的頻道放到「其他」區。
 */
export function toTownPlan(output: PlannerOutput, channels: TownChannel[]): TownPlan {
    const used = new Set<number>();
    const districts = output.districts.flatMap((d) => {
        const ids = d.channels.flatMap((n) => (Number.isInteger(n) && n >= 1 && n <= channels.length && !used.has(n) ? (used.add(n), [channels[n - 1].id]) : []));
        if (!ids.length) return [];
        const size = Object.hasOwn(ROOM_SIZES, d.size) ? d.size : "medium";
        const floor = FLOORS.includes(d.floor) ? d.floor : undefined;
        return [{ name: d.name.trim().slice(0, MAX_DISTRICT_NAME), channels: ids, size, ...(floor ? { floor } : {}) }];
    });
    if (!districts.length) throw new PlannerRejected("Claude 回的規劃裡沒有用到任何頻道，請再試一次");
    return { districts };
}
