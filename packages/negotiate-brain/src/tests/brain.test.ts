import { describe, it, expect } from "vitest";
import { NegotiationBrain, fallbackDecision, type BrainContext } from "../brain.js";

function ctx(over: Partial<BrainContext> = {}): BrainContext {
  return {
    role: "buyer",
    price: 20, // buyer ceiling
    qty: 1,
    terms: "per-hour billing",
    requirements: { gpu: "H100" },
    maxRounds: 10,
    minDelta: 0.01,
    seed: 42,
    ...over,
  };
}

describe("deterministic fallback brain", () => {
  it("opens at the agent's own bound", () => {
    const d = fallbackDecision(ctx(), { round: 1, history: [] });
    expect(d.action).toBe("counteroffer");
    if (d.action === "counteroffer") expect(d.unitPrice).toBeCloseTo(20, 1);
  });

  it("accepts when counterparty is within bound", () => {
    const d = fallbackDecision(ctx(), {
      round: 2,
      lastTerms: { unitPrice: 18 },
      history: [{ from: "seller", unitPrice: 18 }],
    });
    expect(d.action).toBe("accept");
    if (d.action === "accept") expect(d.unitPrice).toBe(18);
  });

  it("never proposes outside the bound", () => {
    for (let r = 1; r <= 10; r++) {
      const d = fallbackDecision(ctx({ role: "buyer" }), {
        round: r,
        lastTerms: { unitPrice: 5 }, // way below ceiling
        history: [{ from: "seller", unitPrice: 5 }],
      });
      if (d.action === "counteroffer" || d.action === "accept") {
        expect((d as any).unitPrice).toBeLessThanOrEqual(20);
      }
    }
  });

  it("is reproducible for the same seed + inputs", () => {
    const a = fallbackDecision(ctx({ seed: 7 }), {
      round: 3,
      lastTerms: { unitPrice: 12 },
      history: [{ from: "seller", unitPrice: 12 }],
    });
    const b = fallbackDecision(ctx({ seed: 7 }), {
      round: 3,
      lastTerms: { unitPrice: 12 },
      history: [{ from: "seller", unitPrice: 12 }],
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("closes when hardMax exceeded (buyer safety)", () => {
    const d = fallbackDecision(ctx({ role: "buyer", hardMax: 15 }), {
      round: 2,
      lastTerms: { unitPrice: 100 },
      history: [{ from: "seller", unitPrice: 100 }],
    });
    expect(d.action).toBe("close");
  });

  it("brain sans LLM uses the fallback", async () => {
    const brain = new NegotiationBrain(ctx(), { useLLM: false });
    const d = await brain.decide({ round: 1, history: [] });
    expect(d.action).toBe("counteroffer");
  });
});
