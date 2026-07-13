import { describe, it, expect } from "vitest";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { nextPrice, accepts, type NegotiationPolicy } from "../negotiate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_ROOT = resolve(__dirname, "../../../../contracts/schemas");

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

function loadSchema(name: string) {
  const raw = JSON.parse(readFileSync(resolve(SCHEMA_ROOT, name), "utf8"));
  delete raw.$schema; // ajv defaults to draft-07; strip 2020-12 declaration
  return raw;
}
const intentValidator = ajv.compile(loadSchema("intent.json"));
const offerValidator = ajv.compile(loadSchema("offer.json"));

const REG = "eip155:84532:0x8004A818BFB912233c491871b3d84c89A494BD9e";

describe("intent schema (contracts/schemas/intent.json)", () => {
  it("accepts a valid buyer intent", () => {
    const intent = {
      resource: "gpu", qty: 5, unit: "hour", maxUnitPrice: 20,
      requirements: { cuda: "12.1", gpu: "H100" },
      agentRegistry: REG, agentId: "1", wallet: "0xAbC123",
    };
    expect(intentValidator(intent)).toBe(true);
  });

  it("rejects missing required fields", () => {
    expect(intentValidator({ resource: "gpu" })).toBe(false);
  });

  it("rejects bad wallet format", () => {
    expect(intentValidator({
      resource: "gpu", qty: 1, unit: "hour", maxUnitPrice: 1,
      agentRegistry: REG, agentId: "1", wallet: "not-a-hex",
    })).toBe(false);
  });

  it("rejects bad agentRegistry (must start eip155:)", () => {
    expect(intentValidator({
      resource: "gpu", qty: 1, unit: "hour", maxUnitPrice: 1,
      agentRegistry: "base:123", agentId: "1", wallet: "0xAbC123",
    })).toBe(false);
  });
});

describe("offer schema (contracts/schemas/offer.json)", () => {
  it("accepts a valid seller offer", () => {
    const offer = {
      resource: "gpu", unit: "hour", unitPrice: 18,
      terms: "per-hour billing, cancel anytime",
      requirements: { cuda: "12.1", gpu: "H100" },
      agentRegistry: REG, agentId: "2", wallet: "0x5e11e7",
    };
    expect(offerValidator(offer)).toBe(true);
  });

  it("rejects offer without terms", () => {
    expect(offerValidator({
      resource: "gpu", unit: "hour", unitPrice: 18,
      agentRegistry: REG, agentId: "2", wallet: "0x5e11e7",
    })).toBe(false);
  });
});

describe("negotiation convergence (nextPrice / accepts)", () => {
  const base = (role: "buyer" | "seller", price: number): NegotiationPolicy => ({
    role, price, qty: 5, terms: "t", requirements: {}, minDelta: 0.01, maxRounds: 10,
  });

  it("buyer accepts when counterparty price <= max", () => {
    expect(accepts(base("buyer", 20), 18)).toBe(true);
    expect(accepts(base("buyer", 20), 21)).toBe(false);
  });

  it("seller accepts when counterparty price >= floor", () => {
    expect(accepts(base("seller", 15), 18)).toBe(true);
    expect(accepts(base("seller", 15), 14)).toBe(false);
  });

  it("buyer response moves down by >= minDelta toward counterparty (not exact land)", () => {
    const p = base("buyer", 20);
    const move = nextPrice(p, 15); // midpoint-ish move down from 20 toward 15
    expect(move).toBeLessThan(20);
    expect(move).toBeGreaterThan(15);
    expect(20 - move).toBeGreaterThanOrEqual(0.01);
  });

  it("seller response moves up by >= minDelta toward counterparty (not exact land)", () => {
    const p = base("seller", 15);
    const move = nextPrice(p, 20); // midpoint-ish move up from 15 toward 20
    expect(move).toBeGreaterThan(15);
    expect(move).toBeLessThan(20);
    expect(move - 15).toBeGreaterThanOrEqual(0.01);
  });

  it("converges to a deal within bounds for buyer max 20 / seller floor 15", () => {
    // Simulate the REAL sequence: each side OPENS at its own bound first, then
    // responds with nextPrice (midpoint move, >= minDelta). A deal closes when
    // one side accepts the other's price within its bound.
    const buyer: NegotiationPolicy = base("buyer", 20);
    const seller: NegotiationPolicy = base("seller", 15);
    let buyerPrice = buyer.price; // opening offer = 20 (buyer's max)
    let sellerPrice = seller.price; // opening offer = 15 (seller's floor)
    let rounds = 0;
    let deal = false;
    while (rounds < buyer.maxRounds!) {
      rounds++;
      // seller responds to buyer's opening/last price
      sellerPrice = nextPrice(seller, buyerPrice);
      if (accepts(seller, buyerPrice)) { deal = true; break; }
      // buyer responds to seller's new price
      buyerPrice = nextPrice(buyer, sellerPrice);
      if (accepts(buyer, sellerPrice)) { deal = true; break; }
    }
    expect(deal).toBe(true);
    expect(buyerPrice).toBeLessThanOrEqual(20);
    expect(sellerPrice).toBeGreaterThanOrEqual(15);
    // the agreed price is within both bounds
    const agreed = Math.min(buyerPrice, sellerPrice);
    expect(agreed).toBeLessThanOrEqual(20);
    expect(agreed).toBeGreaterThanOrEqual(15);
  });
});
