import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../app";
import type { FastifyInstance } from "fastify";

const intentBody = {
  resource: "gpu", qty: 5, unit: "hour", maxUnitPrice: 20,
  requirements: { cuda: "12.1", gpu: "H100" },
  agentRegistry: "eip155:84532:0x8004A818BFB912233c491871b3d84c89A494BD9e",
  agentId: "1", wallet: "0xBUYER",
};
const offerBody = {
  resource: "gpu", unit: "hour", unitPrice: 18, terms: "per-hour",
  requirements: { cuda: "12.1", gpu: "H100" },
  agentRegistry: "eip155:84532:0x8004A818BFB912233c491871b3d84c89A494BD9e",
  agentId: "2", wallet: "0xSELLER",
};

describe("intake HTTP API", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = buildApp(); await app.ready(); });
  afterAll(async () => { await app.close(); });

  it("health", async () => {
    const r = await app.inject({ method: "GET", url: "/health" });
    expect(r.json()).toEqual({ ok: true });
  });

  it("POST /intents valid -> 201 + intentId", async () => {
    const r = await app.inject({ method: "POST", url: "/intents", payload: intentBody });
    expect(r.statusCode).toBe(201);
    expect(r.json().intentId).toBeTruthy();
  });

  it("POST /intents invalid (bad wallet) -> 400", async () => {
    const r = await app.inject({ method: "POST", url: "/intents", payload: { ...intentBody, wallet: "bad" } });
    expect(r.statusCode).toBe(400);
  });

  it("seeded offer + new intent -> match with roomId + wssUrl", async () => {
    // seed.ts already added a matching offer; posting intent should match.
    const r = await app.inject({ method: "POST", url: "/intents", payload: intentBody });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.matched).toBe(true);
    expect(body.roomId).toBeTruthy();
    expect(body.wssUrl).toContain("/negotiate/");
    // lookup via matches endpoint
    const m = await app.inject({ method: "GET", url: `/matches/${body.intentId}` });
    expect(m.json().matched).toBe(true);
  });

  it("mismatched offer returns matched:false", async () => {
    const r = await app.inject({
      method: "POST", url: "/offers",
      payload: { ...offerBody, unitPrice: 25 },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().matched).toBe(false);
  });

  it("identity seam accepts valid, rejects invalid", async () => {
    const ok = await app.inject({ method: "POST", url: "/_identity", payload: { agentRegistry: "eip155:1:0xabc", agentId: "1", wallet: "0x1234" } });
    expect(ok.json().ok).toBe(true);
    const bad = await app.inject({ method: "POST", url: "/_identity", payload: { agentRegistry: "eip155:1:0xabc", agentId: "1", wallet: "xx" } });
    expect(bad.json().ok).toBe(false);
  });
});
