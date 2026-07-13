import { describe, it, expect } from "vitest";
import { Store, matches } from "../store";
import type { Intent, Offer } from "../types";
import { verifyOrRegister } from "../identity";
import { Matchmaker } from "../matchmaker";

const baseIntent: Intent = {
  resource: "gpu", qty: 5, unit: "hour", maxUnitPrice: 20,
  requirements: { cuda: "12.1", gpu: "H100" },
  agentRegistry: "eip155:84532:0x8004A818BFB912233c491871b3d84c89A494BD9e",
  agentId: "1", wallet: "0xBUYER",
};
const baseOffer: Offer = {
  resource: "gpu", unit: "hour", unitPrice: 18, terms: "t",
  requirements: { cuda: "12.1", gpu: "H100" },
  agentRegistry: "eip155:84532:0x8004A818BFB912233c491871b3d84c89A494BD9e",
  agentId: "2", wallet: "0xSELLER",
};

describe("store.matches", () => {
  it("matches compatible intent+offer", () => {
    expect(matches(baseIntent, baseOffer)).toBe(true);
  });
  it("rejects when offer price > intent max", () => {
    expect(matches(baseIntent, { ...baseOffer, unitPrice: 25 })).toBe(false);
  });
  it("rejects when resource differs", () => {
    expect(matches({ ...baseIntent, resource: "tpu" }, baseOffer)).toBe(false);
  });
  it("rejects when requirement missing on offer", () => {
    expect(matches(baseIntent, { ...baseOffer, requirements: { cuda: "12.1" } })).toBe(false);
  });
});

describe("identity.verifyOrRegister", () => {
  it("accepts valid eip155 + 0x wallet", () => {
    expect(verifyOrRegister({ agentRegistry: "eip155:1:0xabc", agentId: "1", wallet: "0x1234" }))
      .toEqual({ ok: true, registered: false });
  });
  it("rejects bad wallet", () => {
    expect(verifyOrRegister({ agentRegistry: "eip155:1:0xabc", agentId: "1", wallet: "nothex" }).ok)
      .toBe(false);
  });
});

describe("Matchmaker", () => {
  it("opens a room when an intent matches an existing offer", () => {
    const s = new Store();
    const offerId = s.addOffer(baseOffer);
    const m = new Matchmaker(s);
    const intentId = s.addIntent(baseIntent);
    const res = m.onIntent(intentId);
    expect(res.matched).toBe(true);
    expect(res.roomId).toBeTruthy();
    expect(res.wssUrl).toContain("/negotiate/");
    // lookup by intent id returns the same room
    const look = m.lookup(intentId);
    expect(look.roomId).toBe(res.roomId);
    // offer id also resolves
    expect(m.lookup(offerId).roomId).toBe(res.roomId);
  });
  it("does not match when price too high", () => {
    const s = new Store();
    s.addOffer({ ...baseOffer, unitPrice: 25 });
    const m = new Matchmaker(s);
    const intentId = s.addIntent(baseIntent);
    expect(m.onIntent(intentId).matched).toBe(false);
  });
});
