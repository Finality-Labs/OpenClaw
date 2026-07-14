import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../app";
import type { FastifyInstance } from "fastify";

const offerBody = {
  resource: "gpu", unit: "hour", unitPrice: 18, terms: "per-hour",
  requirements: { cuda: "12.1", gpu: "H100" },
  agentRegistry: "eip155:84532:0x8004A818BFB912233c491871b3d84c89A494BD9e",
  agentId: "PulseVendor", wallet: "0xSELLER",
  pulseMinutes: 145,
};

describe("intake offer pulse + registry feed", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = buildApp(); await app.ready(); });
  afterAll(async () => { await app.close(); });

  it("POST /offers stores pulseMinutes + active", async () => {
    const r = await app.inject({ method: "POST", url: "/offers", payload: offerBody });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.offerId).toBeTruthy();
    // registry view reflects active + version
    const reg = await app.inject({ method: "GET", url: `/offers/${body.offerId}/registry` });
    expect(reg.json().active).toBe(true);
    expect(reg.json().registryVersion).toBe(1);
  });

  it("POST /offers/:id/pulse re-asserts active and returns match state", async () => {
    const created = await app.inject({ method: "POST", url: "/offers", payload: offerBody });
    const offerId = created.json().offerId;
    const r = await app.inject({ method: "POST", url: `/offers/${offerId}/pulse` });
    expect(r.statusCode).toBe(200);
    expect(r.json().pulsed).toBe(true);
    expect(r.json().active).toBe(true);
  });

  it("POST /offers/:id/pulse on unknown id -> 404", async () => {
    const r = await app.inject({ method: "POST", url: `/offers/nope/pulse` });
    expect(r.statusCode).toBe(404);
  });

  it("registry notify bumps version so a seller agent can detect change", async () => {
    const created = await app.inject({ method: "POST", url: "/offers", payload: offerBody });
    const offerId = created.json().offerId;
    const before = (await app.inject({ method: "GET", url: `/offers/${offerId}/registry` })).json().registryVersion;
    const note = await app.inject({ method: "POST", url: `/registry/PulseVendor/notify` });
    expect(note.json().changed).toBe(true);
    const after = (await app.inject({ method: "GET", url: `/offers/${offerId}/registry` })).json().registryVersion;
    expect(after).toBe(before + 1);
  });

  it("GET /registry/:agentId lists that seller's offers", async () => {
    await app.inject({ method: "POST", url: "/offers", payload: offerBody });
    const r = await app.inject({ method: "GET", url: `/registry/PulseVendor` });
    expect(Array.isArray(r.json().offers)).toBe(true);
    expect(r.json().offers.length).toBeGreaterThan(0);
  });
});
