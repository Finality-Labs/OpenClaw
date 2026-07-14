import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startServer } from "@finality/negotiate/index.js";
import type { WebSocketServer } from "ws";
import { runAgent, type AgentDeps } from "../agent.js";

// Drive two brain-backed agents against the REAL negotiate Room (the production
// WebSocket server), proving the brain wires correctly into the deterministic
// settlement path. On a deal-closed we assert the price is inside both bounds
// and the transcript hash is a valid keccak256 (included in the proof).

let wss: WebSocketServer;

async function runPair(seed: number, roomId: string): Promise<{ unitPrice?: number; hash: string }> {
  const url = `ws://localhost:3999/negotiate/${roomId}`;
  const buyer: AgentDeps = {
    wsUrl: url,
    role: "buyer",
    identity: { agentRegistry: "eip155:1", agentId: "buyer-1", wallet: "0x" + "11".repeat(20) },
    ctx: { price: 20, qty: 1, terms: "per-hour", requirements: {}, maxRounds: 10, minDelta: 0.01, seed },
    opts: { timeoutMs: 8000, log: () => {} },
  };
  const seller: AgentDeps = {
    wsUrl: url,
    role: "seller",
    identity: { agentRegistry: "eip155:1", agentId: "seller-1", wallet: "0x" + "22".repeat(20) },
    ctx: { price: 15, qty: 1, terms: "per-hour", requirements: {}, maxRounds: 10, minDelta: 0.01, seed },
    opts: { timeoutMs: 8000, log: () => {} },
  };
  const [b, s] = await Promise.all([runAgent(buyer), runAgent(seller)]);
  expect(b.kind).toBe("deal-closed");
  expect(s.kind).toBe("deal-closed");
  return { unitPrice: b.unitPrice, hash: b.transcriptHash ?? "" };
}

beforeAll(() => {
  wss = startServer(3999);
});
afterAll(() => {
  wss.close();
});

describe("brain-driven negotiation e2e", () => {
  it("two agents reach a deal inside both bounds", async () => {
    const r = await runPair(42, "e2e-a");
    expect(r.unitPrice).toBeGreaterThanOrEqual(15);
    expect(r.unitPrice).toBeLessThanOrEqual(20);
    expect(r.hash).toMatch(/^0x[0-9a-f]{64}$/);
  }, 20000);

  it("is reproducible (same seed → same price + same transcript hash)", async () => {
    const a = await runPair(42, "e2e-b");
    const b = await runPair(42, "e2e-c");
    expect(a.unitPrice).toBe(b.unitPrice);
    expect(a.hash).toBe(b.hash);
  }, 20000);
});
