import assert from "assert";
import type { Request } from "express";
import type { ColyseusTestServer } from "@colyseus/testing";
import type appConfig from "../src/app.config.js";
import { isLocalRequest } from "../src/app.config.js";
import { testServer } from "./testServer.js";

const req = (ip: string, headers: Record<string, string> = {}) =>
    ({ socket: { remoteAddress: ip }, headers }) as unknown as Request;

describe("isLocalRequest", () => {
    it("本機直連算本機（IPv4、IPv6）", () => {
        assert.ok(isLocalRequest(req("127.0.0.1")));
        assert.ok(isLocalRequest(req("::1")));
        assert.ok(isLocalRequest(req("::ffff:127.0.0.1")));
    });

    it("區網的人直接連伺服器不算", () => {
        assert.ok(!isLocalRequest(req("192.168.1.20")));
    });

    it("經 Cloudflare（cloudflared 通道、Discord 代理）轉進來的不算，就算來源是 127.0.0.1", () => {
        assert.ok(!isLocalRequest(req("127.0.0.1", { "cf-ray": "8f00000000000000-TPE" })));
    });

    it("經 ngrok 或反向代理轉進來的不算", () => {
        assert.ok(!isLocalRequest(req("127.0.0.1", { "x-forwarded-for": "203.0.113.5" })));
    });
});

describe("開發工具只給本機", () => {
    let colyseus: ColyseusTestServer<typeof appConfig>;
    before(async () => (colyseus = await testServer()));

    it("本機看得到 monitor", async () => {
        const { data } = await colyseus.http.get("/colyseus/api");
        assert.ok(Array.isArray(data.rooms));
    });

    for (const [via, headers] of [
        ["Cloudflare", { "cf-ray": "x" }],
        ["ngrok", { "x-forwarded-for": "203.0.113.5" }],
    ] as const) {
        it(`經 ${via} 進來看不到 monitor 和 playground（當作不存在）`, async () => {
            for (const path of ["/colyseus/api", "/"]) {
                await assert.rejects(colyseus.http.get(path, { headers }), (e: any) => e.statusCode === 404, path);
            }
        });
    }
});
