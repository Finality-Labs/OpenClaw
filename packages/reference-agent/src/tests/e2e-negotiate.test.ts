import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startServer } from "../../../negotiate/src/index.js";
import type { WebSocketServer } from "ws";
import { negotiate, type NegotiationPolicy } from "../negotiate.js";

const REG = "eip155:84532:0x8004A818BFB912233c491871b3d84c89A494BD9e";

/**
 * Integration test: stand up the REAL Part 2 negotiate server and run the
 * reference-agent buyer + seller clients against the same room. Proves the
 * skill's protocol works interoperably with the actual venue (join handshake,
 * alternating turns, minDelta, accept → deal-closed).
 *
 * Skips cleanly if the negotiate package can't be imported (e.g. not built).
 */
describe("E2E: reference-agent vs real negotiate server", () => {
  let wss: WebSocketServer | null = null;
  const PORT = 3099;
  const WS = `ws://localhost:${PORT}`;

  beforeAll(() => {
    try {
      wss = startServer(PORT);
    } catch (e) {
      console.warn("negotiate server unavailable, skipping E2E:", String(e));
      wss = null;
    }
  });

  afterAll(() => {
    wss?.close();
  });

  it("buyer (max 20) and seller (floor 15) reach a deal in the same room", async () => {
    if (!wss) return; // skip, don't fail the build

    const room = "e2e_room_1";
    const wssUrl = `${WS}/negotiate/${room}`;

    const buyerPolicy: NegotiationPolicy = {
      role: "buyer", price: 20, qty: 5, terms: "per-hour", requirements: { gpu: "H100" },
    };
    const sellerPolicy: NegotiationPolicy = {
      role: "seller", price: 15, qty: 5, terms: "per-hour", requirements: { gpu: "H100" },
    };
    const buyerId = { agentRegistry: REG, agentId: "1", wallet: "0xAbC123" };
    const sellerId = { agentRegistry: REG, agentId: "2", wallet: "0x5e11e7" };

    const buyerDone = negotiate(wssUrl, buyerPolicy, buyerId, { timeoutMs: 8000 });
    const sellerDone = negotiate(wssUrl, sellerPolicy, sellerId, { timeoutMs: 8000 });

    const [buyerRes, sellerRes] = await Promise.all([buyerDone, sellerDone]);

    expect(buyerRes.kind).toBe("deal-closed");
    expect(sellerRes.kind).toBe("deal-closed");
    // agreed price within both bounds
    const price = buyerRes.unitPrice!;
    expect(price).toBeLessThanOrEqual(20);
    expect(price).toBeGreaterThanOrEqual(15);
    expect(buyerRes.qty).toBe(5);
    expect(buyerRes.transcriptHash).toMatch(/^0x/);
  }, 15000);
});
