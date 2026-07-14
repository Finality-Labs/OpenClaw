/**
 * LangGraph negotiation flow — the "cherry on the cake".
 *
 * The brain (brain.ts) is a single decision function. Wrapping it in a LangGraph
 * gives us an explicit, inspectable reasoning flow that LangSmith traces:
 *
 *    think ──▶ validate ──▶ guard ──▶ decide ──▶ (route)
 *                                   │
 *                                   └─> reject/close → END
 *                                        accept/counteroffer → emit
 *
 * Each node is a pure-ish step. Because the graph is deterministic given the
 * same state + same brain, the whole negotiation remains reproducible for audit.
 *
 * Run with LANGCHAIN_TRACING_V2=true and LANGCHAIN_API_KEY set to see every
 * step in LangSmith. Without an LLM, the `decide` node uses the deterministic
 * fallback but the graph structure is identical (so traces look the same).
 */

import { StateGraph, END } from "@langchain/langgraph";
import { NegotiationBrain, type BrainContext, type TurnInput, type BrainDecision } from "./brain.js";

export interface NegotiationState {
  ctx: BrainContext;
  input: TurnInput;
  decision?: BrainDecision;
  guarded: boolean; // set by the guard node
}

// Node: assemble the prompt + invoke the brain (LLM or deterministic fallback).
async function think(state: NegotiationState): Promise<Partial<NegotiationState>> {
  const brain = new NegotiationBrain(state.ctx);
  const decision = await brain.decide(state.input);
  return { decision };
}

// Node: structural validation is already done inside the brain via zod; here we
// re-confirm the decision is internally consistent (a structured-output gate).
function validate(state: NegotiationState): Partial<NegotiationState> {
  const d = state.decision;
  if (!d) throw new Error("no decision produced");
  if ((d.action === "counteroffer" || d.action === "accept") && typeof d.unitPrice !== "number") {
    throw new Error(`decision ${d.action} missing unitPrice`);
  }
  return {};
}

// Node: guardrail. The room enforces bounds, but we double-check here so a
// malformed/unguarded model output can never leave the agent. This is the
// in-process safety net; NeMo Guardrails (Python sidecar) adds semantic
// guards at the orchestrator boundary.
function guard(state: NegotiationState): Partial<NegotiationState> {
  const d = state.decision!;
  if (d.action === "counteroffer" || d.action === "accept") {
    const p = d.unitPrice as number;
    const within = state.ctx.role === "buyer" ? p <= state.ctx.price : p >= state.ctx.price;
    if (!within) {
      // Clamp defensively; the brain already clamps, this is belt-and-suspenders.
      const clamped = state.ctx.role === "buyer" ? state.ctx.price : state.ctx.price;
      return {
        guarded: true,
        decision: { ...d, unitPrice: clamped, argument: d.argument + " [guarded:clamped]" },
      };
    }
  }
  return { guarded: true };
}

// The graph runs one turn (think → validate → guard) and then ENDS. The client
// reads `state.decision` and emits the matching frame over the socket. We do NOT
// loop inside the graph — each WebSocket turn is a fresh graph invocation, which
// keeps traces clean and avoids recursion limits.

export function buildNegotiationGraph() {
  const g = new StateGraph<NegotiationState>({
    channels: {
      ctx: undefined as unknown as NegotiationState["ctx"],
      input: undefined as unknown as NegotiationState["input"],
      decision: undefined as unknown as NegotiationState["decision"],
      guarded: undefined as unknown as boolean,
    },
  } as never)
    .addNode("think", think)
    .addNode("validate", validate)
    .addNode("guard", guard)
    .addEdge("__start__", "think")
    .addEdge("think", "validate")
    .addEdge("validate", "guard")
    .addEdge("guard", END);

  return g.compile();
}

export interface FlowResult {
  decision: BrainDecision;
  guarded: boolean;
}

/** Convenience: run one turn through the graph and return the decision. */
export async function runTurn(
  ctx: BrainContext,
  input: TurnInput,
): Promise<FlowResult> {
  const graph = buildNegotiationGraph();
  const out = await graph.invoke({ ctx, input, guarded: false });
  return { decision: out.decision as BrainDecision, guarded: out.guarded as boolean };
}
