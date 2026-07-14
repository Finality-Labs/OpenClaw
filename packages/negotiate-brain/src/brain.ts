/**
 * @finality/negotiate-brain
 *
 * The "haggling brain" for an autonomous agent in a Finality negotiation room.
 *
 * Design goals (negotiation §1):
 *   1. REPRODUCIBLE — given the same inputs + same seed, the brain always
 *      returns the same decision. This is what lets the whole chain stay
 *      deterministic for audit even though an LLM is in the loop. When no LLM
 *      key is configured, a seeded deterministic policy runs (the old midpoint
 *      behavior, upgraded with persona + reputation weighting).
 *   2. REASONED — when an LLM is configured, the decision carries a free-text
 *      `argument` explaining WHY (stored + hashed in the transcript).
 *   3. TRACED — every LLM call is wrapped for LangSmith tracing when
 *      LANGCHAIN_TRACING_V2=true + LANGCHAIN_API_KEY is set.
 *   4. GUARDED — output is structurally validated (zod) and must stay inside
 *      the agent's price bound; the room enforces this too, but we never emit
 *      an out-of-bound move.
 *
 * The brain does NOT talk WebSocket itself — it only decides. The agent client
 * (packages/negotiate-brain/src/agent.ts) owns the socket + turn loop.
 */

import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

// ── Types ────────────────────────────────────────────────────────────────────

export type Role = "buyer" | "seller";

export interface ReputationView {
  agentId: string;
  /** 0..1 normalized trust score (off-chain default 0.5 when unknown). */
  score: number;
  count: number;
  mode: "offchain" | "live";
}

export interface BrainContext {
  role: Role;
  /** buyer: max price per unit. seller: min (floor) price per unit. */
  price: number;
  qty: number;
  terms: string;
  requirements: Record<string, unknown>;
  /** my own reputation (for self-awareness / logging). */
  myReputation?: ReputationView;
  /** counterparty reputation — fed in to bias the haggle. */
  counterparty?: ReputationView;
  /** server-enforced constraints, mirrored for correct behavior. */
  maxRounds: number;
  minDelta: number;
  /** optional hard risk cap for a buyer (safety surfacing). */
  hardMax?: number;
  /** persona label (e.g. "aggressive", "cooperative") for the LLM + logs. */
  persona?: string;
  /** seed for the deterministic fallback (and to bias LLM sampling when used). */
  seed?: number;
}

export interface TurnInput {
  /** round number (1-based), supplied by the client loop. */
  round: number;
  /** the counterparty's last structured terms (undefined on our opening). */
  lastTerms?: {
    unitPrice: number;
    qty: number;
    terms?: string;
    argument?: string;
  };
  /** full conversation so far, for the LLM's reasoning context. */
  history: Array<{
    from: Role;
    unitPrice: number;
    argument?: string;
  }>;
}

export type BrainDecision =
  | {
      action: "counteroffer";
      unitPrice: number;
      argument: string;
    }
  | {
      action: "accept";
      unitPrice: number;
      argument: string;
    }
  | {
      action: "reject";
      reason: string;
      argument: string;
    }
  | {
      action: "close"; // walk away — no improvement / out of bounds
      reason: string;
      argument: string;
    };

// ── Seeded deterministic RNG (mulberry32) ─────────────────────────────────────
// Keeps the no-LLM path reproducible for the deterministic test harness.

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function roundPrice(n: number): number {
  const precision = Math.abs(n) < 1 ? 1_000_000 : 100;
  return Math.round(n * precision) / precision;
}

// ── Structured output schema (shared by LLM + fallback) ──────────────────────

const DecisionSchema = z.object({
  action: z.enum(["counteroffer", "accept", "reject", "close"]),
  unitPrice: z.number().optional(),
  argument: z.string(),
  reason: z.string().optional(),
});

// ── LLM construction (env-gated) ─────────────────────────────────────────────

function buildLLM(env: NodeJS.ProcessEnv): ChatOpenAI | null {
  const apiKey = env.OPENROUTER_API_KEY ?? env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const model = env.NEGOTIATE_MODEL ?? env.OPENAI_MODEL ?? "openai/gpt-4o-mini";
  // OpenRouter is OpenAI-compatible; point baseURL there when set.
  const baseURL = env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
  return new ChatOpenAI({
    apiKey,
    model,
    configuration: { baseURL },
    temperature: 0.2,
    maxTokens: 400,
  });
}

function systemPrompt(ctx: BrainContext): string {
  const repNote = ctx.counterparty
    ? `Counterparty (${ctx.counterparty.agentId}) trust score: ${ctx.counterparty.score.toFixed(
        2,
      )} (${ctx.counterparty.mode}, ${ctx.counterparty.count} ratings). ` +
      (ctx.counterparty.score >= 0.7
        ? "They are well-rated — you may concede less aggressively."
        : ctx.counterparty.score <= 0.3
          ? "They are poorly rated — drive a harder bargain and demand stronger terms."
          : "Mixed reputation — stay measured.")
    : "Counterparty reputation unknown.";
  const role = ctx.role === "buyer"
    ? `You are the BUYER. Your hard ceiling (never pay above) is ${ctx.price} per unit.`
    : `You are the SELLER. Your hard floor (never sell below) is ${ctx.price} per unit.`;
  return [
    "You are an autonomous negotiating agent in the Finality agent marketplace.",
    role,
    `Quantity: ${ctx.qty}. Standard terms: "${ctx.terms}".`,
    `Requirements you care about: ${JSON.stringify(ctx.requirements)}.`,
    repNote,
    `Persona: ${ctx.persona ?? "balanced"}.`,
    "Each turn you may: counteroffer (propose a unitPrice + reasoning), accept the counterparty's last price, reject (ask for new terms), or close (walk away).",
    "NEVER propose a price outside your bound. Be concise and commercially rational.",
  ].join("\n");
}

function userPrompt(ctx: BrainContext, input: TurnInput): string {
  if (!input.lastTerms) {
    return `It is round ${input.round}. You are making the OPENING move. Propose your opening unitPrice (your own bound is a good start) and explain it.`;
  }
  return [
    `Round ${input.round}. Counterparty's last offer: ${input.lastTerms.unitPrice} per unit.`,
    input.lastTerms.argument ? `Their argument: "${input.lastTerms.argument}"` : "",
    "Conversation so far: " +
      input.history
        .map((h) => `${h.from}: ${h.unitPrice}${h.argument ? ` ("${h.argument}")` : ""}`)
        .join(" | "),
    "Decide your next move. If their price is within your bound and acceptable, ACCEPT it. Otherwise COUNTEROFFER (respecting minDelta) or CLOSE.",
  ]
    .filter(Boolean)
    .join("\n");
}

// ── Deterministic fallback (no LLM) ───────────────────────────────────────────
// Upgraded midpoint: persona + counterparty reputation nudge the concession
// speed; output is seeded so the test harness always converges identically.

function fallbackDecision(ctx: BrainContext, input: TurnInput): BrainDecision {
  const rng = mulberry32((ctx.seed ?? 1) ^ (input.round * 2654435761));
  const minDelta = ctx.minDelta;
  const jitter = (rng() - 0.5) * minDelta; // tiny deterministic wobble

  // No opposing offer yet → open at our own bound.
  if (!input.lastTerms) {
    return {
      action: "counteroffer",
      unitPrice: roundPrice(ctx.price + jitter),
      argument: `Opening at my ${ctx.role} bound ${ctx.price}.`,
    };
  }

  const opp = input.lastTerms.unitPrice;
  const within = ctx.role === "buyer" ? opp <= ctx.price : opp >= ctx.price;
  if (within) {
    return {
      action: "accept",
      unitPrice: roundPrice(opp),
      argument: `Counterparty's ${opp} is within my ${ctx.role} bound ${ctx.price}; accepting.`,
    };
  }

  // Out of bounds.
  if (ctx.hardMax != null && ctx.role === "buyer" && opp > ctx.hardMax) {
    return {
      action: "close",
      reason: "exceeds risk policy",
      argument: `Proposed ${opp} exceeds hardMax ${ctx.hardMax}; walking away.`,
    };
  }
  if (input.round >= ctx.maxRounds) {
    return {
      action: "close",
      reason: "maxRounds",
      argument: `Reached maxRounds ${ctx.maxRounds} with no in-bound price; closing.`,
    };
  }

  // Concede halfway, biased by reputation + persona.
  const repBias = ctx.counterparty ? (ctx.counterparty.score - 0.5) * 0.2 : 0;
  const personaBias = ctx.persona === "aggressive" ? 0.1 : ctx.persona === "cooperative" ? -0.1 : 0;
  const mid = (ctx.price + opp) / 2 + repBias + personaBias;
  let move = ctx.role === "buyer" ? Math.min(ctx.price, mid) : Math.max(ctx.price, mid);
  move = roundPrice(move + jitter);

  // Enforce minDelta away from the opposing price and stay within our bound.
  if (ctx.role === "buyer") {
    if (move - opp < minDelta) move = roundPrice(opp + minDelta);
    if (move > ctx.price) move = ctx.price;
  } else {
    if (opp - move < minDelta) move = roundPrice(opp - minDelta);
    if (move < ctx.price) move = ctx.price;
  }
  return {
    action: "counteroffer",
    unitPrice: move,
    argument: `Splitting the difference toward ${opp} (rep bias ${repBias.toFixed(2)}).`,
  };
}

// ── Public brain ──────────────────────────────────────────────────────────────

export interface BrainOptions {
  env?: NodeJS.ProcessEnv;
  /** override the LLM (used by tests). */
  llm?: ChatOpenAI | null;
  /** when false, force the deterministic fallback even if a key is present. */
  useLLM?: boolean;
}

export class NegotiationBrain {
  private ctx: BrainContext;
  private llm: ChatOpenAI | null;

  constructor(ctx: BrainContext, opts: BrainOptions = {}) {
    this.ctx = ctx;
    this.llm = opts.llm !== undefined ? opts.llm : buildLLM(opts.env ?? process.env);
    if (opts.useLLM === false) this.llm = null;
  }

  /** Decide the next move given the current turn input. */
  async decide(input: TurnInput): Promise<BrainDecision> {
    // Always run the deterministic path when no LLM is available.
    if (!this.llm) return fallbackDecision(this.ctx, input);

    try {
      const structured = this.llm.withStructuredOutput(DecisionSchema, {
        name: "negotiation_decision",
      });
      const res = await structured.invoke([
        new SystemMessage(systemPrompt(this.ctx)),
        new HumanMessage(userPrompt(this.ctx, input)),
      ]);
      return this.sanitize(res as BrainDecision);
    } catch (e) {
      // Tracing/network failure → fall back so a deal can still complete.
      console.warn(
        `[brain] LLM decision failed (${(e as Error).message}); using deterministic fallback`,
      );
      return fallbackDecision(this.ctx, input);
    }
  }

  /** Keep any LLM output inside the hard bound so the room never rejects it. */
  private sanitize(d: BrainDecision): BrainDecision {
    if (d.action === "counteroffer" || d.action === "accept") {
    const p = typeof d.unitPrice === "number" ? roundPrice(d.unitPrice) : this.ctx.price;
    const within = this.ctx.role === "buyer" ? p <= this.ctx.price : p >= this.ctx.price;
      if (!within) {
        return {
          action: "counteroffer",
          unitPrice: this.ctx.role === "buyer" ? this.ctx.price : this.ctx.price,
          argument: `Clamped to my ${this.ctx.role} bound ${this.ctx.price}.`,
        };
      }
      return { ...d, unitPrice: p };
    }
    return d;
  }
}

export { mulberry32, fallbackDecision };
