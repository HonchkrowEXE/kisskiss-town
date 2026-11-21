import assert from "assert";
import type { ColyseusTestServer } from "@colyseus/testing";
import { JWT } from "colyseus";
import type appConfig from "../src/app.config.js";
import { testServer } from "./testServer.js";
import { PhotoRejected, PhotoUnavailable, featuresToAppearance, nearest, usePhotoReader, type PhotoFeatures } from "../src/characters/photoLook.js";
import { resetPhotoCooldown } from "../src/characters/photoRoute.js";
import { CLOTH_COLORS, DEFAULT_APPEARANCE } from "../src/town/appearance.js";

const FEATURES: PhotoFeatures = {
    person_found: true,
    hair_style: "long",
    hair_color: "#f0d070", // 接近金
    skin_tone: "#8a5a30", // 接近深
    top_style: "hoodie",
    top_color: "#2e7d32", // 接近綠
    bottom_style: "skirt",
    bottom_color: "#101010", // 接近黑
};

describe("照片特徵對應到部件", () => {
    it("挑最接近的部件與顏色", () => {
        assert.deepStrictEqual(featuresToAppearance(FEATURES), {
            hair: "long", hairColor: "金", skin: "深", top: "hoodie", topColor: "綠", bottom: "skirt", bottomColor: "黑", shoesColor: "黑",
        });
    });

    it("光頭對應到沒有頭髮；看不到下半身用預設的下身", () => {
        const look = featuresToAppearance({ ...FEATURES, hair_style: "bald", bottom_style: "unknown" });
        assert.strictEqual(look.hair, "none");
        assert.deepStrictEqual([look.bottom, look.bottomColor], [DEFAULT_APPEARANCE.bottom, DEFAULT_APPEARANCE.bottomColor]);
    });

    it("看不懂的顏色用預設外觀的那一項", () => {
        const look = featuresToAppearance({ ...FEATURES, hair_color: "金色", top_color: "" });
        assert.deepStrictEqual([look.hairColor, look.topColor], [DEFAULT_APPEARANCE.hairColor, DEFAULT_APPEARANCE.topColor]);
    });

    it("最接近的顏色：大小寫、沒有 # 都可以", () => {
        assert.strictEqual(nearest(CLOTH_COLORS, "#D9534F"), "紅");
        assert.strictEqual(nearest(CLOTH_COLORS, "3d6bd6"), "藍");
        assert.strictEqual(nearest(CLOTH_COLORS, "nope"), undefined);
    });
});

describe("/photo_look 路由", () => {
    let colyseus: ColyseusTestServer<typeof appConfig>;
    const PHOTO = { mediaType: "image/png", base64: "iVBORw0KGgo=" };

    before(async () => (colyseus = await testServer()));
    beforeEach(() => {
        resetPhotoCooldown();
        usePhotoReader(async () => FEATURES);
    });

    let nextId = 7000;
    async function post(body: object, signed = true) {
        const token = await JWT.sign({ id: `${nextId++}`, name: "小明", guildId: "9000000000000000001" });
        return colyseus.http.post("/photo_look", { body, headers: signed ? { Authorization: `Bearer ${token}` } : {} });
    }
    const status = (e: any) => e.statusCode;

    it("照片換成外觀；照片內容不會出現在回應裡", async () => {
        const { data } = await post(PHOTO);
        assert.strictEqual(data.appearance.hairColor, "金");
        assert.strictEqual(JSON.stringify(data).includes(PHOTO.base64), false);
    });

    it("沒登入、格式不對、太大都被拒", async () => {
        await assert.rejects(post(PHOTO, false), (e: any) => status(e) === 401);
        await assert.rejects(post({ ...PHOTO, mediaType: "image/bmp" }), (e: any) => status(e) === 400);
        await assert.rejects(post({ ...PHOTO, base64: "<script>" }), (e: any) => status(e) === 400);
        await assert.rejects(post({ ...PHOTO, base64: "A".repeat(7 * 1024 * 1024) }), (e: any) => status(e) === 413);
    });

    it("照片裡找不到人時說明原因", async () => {
        usePhotoReader(async () => ({ ...FEATURES, person_found: false }));
        await assert.rejects(post(PHOTO), (e: any) => status(e) === 422);
    });

    it("沒設定 Claude API、或 Claude 不處理時，退回手動並說明原因", async () => {
        usePhotoReader(async () => {
            throw new PhotoUnavailable("伺服器還沒設定 Claude API，先用手動選部件");
        });
        await assert.rejects(post(PHOTO), (e: any) => status(e) === 503 && /手動/.test(JSON.stringify(e.data)));
        usePhotoReader(async () => {
            throw new PhotoRejected("這張照片沒辦法處理");
        });
        await assert.rejects(post(PHOTO), (e: any) => status(e) === 422);
    });

    it("同一個人 30 秒內不能再用（每次都要付費）", async () => {
        const token = await JWT.sign({ id: "7999", name: "小明", guildId: "9000000000000000001" });
        const send = () => colyseus.http.post("/photo_look", { body: PHOTO, headers: { Authorization: `Bearer ${token}` } });
        await send();
        await assert.rejects(send(), (e: any) => status(e) === 429);
    });
});
