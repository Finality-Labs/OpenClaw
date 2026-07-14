/**
 * Trace runner — run the full Finality stack and watch the negotiation step by
 * step, with labeled logging for EVERY event:
 *   room ready → open → each counteroffer (with the agent's reasoning/argument)
 *   → guardrail verdict → accept → deal-closed + tamper-proof transcript hash.
 *
 * Run (from repo root):
 *   npx tsx scripts/trace-negotiation.ts
 *
 * To ALSO get LLM-level tracing in LangSmith, export these first:
 *   export LANGCHAIN_TRACING_V2=true
 *   export LANGCHAIN_API_KEY=ls__your_key
 *   export OPENROUTER_API_KEY=sk-or-OPENAI_API_KEY=sk-...   # live LLM reasoning
 * (Without a key the brain uses the deterministic fallback — still fully traced.)
 */
import { startSystem } from "../packages/orchestrator/src/start-all.js";
import { runAgent, type AgentDeps } from "../packages/negotiate-brain/src/agent.js";

const registry = "eip155:84532:0x8004A818BFB912233c491871b3d84c89A494BD9e";
const buyerWallet = process.env.GOAT_BUYER_WALLET ?? "0x1111111111111111111111111111111111111111";
const sellerWallet = process.env.GOAT_SELLER_WALLET ?? "0x2222222222222222222222222222222222222222";
const buyerPrice = Number(process.env.TRACE_BUYER_PRICE ?? 20);
const sellerFloor = Number(process.env.TRACE_SELLER_FLOOR ?? 15);
const offerPrice = Number(process.env.TRACE_OFFER_PRICE ?? sellerFloor);
const maxRounds = Number(process.env.TRACE_MAX_ROUNDS ?? 10);
const timeoutMs = Number(process.env.TRACE_TIMEOUT_MS ?? 10_000);
const expectNoDeal = process.env.TRACE_EXPECT_NO_DEAL === "1";
const buyerPersona = process.env.TRACE_BUYER_PERSONA ?? "balanced";
const sellerPersona = process.env.TRACE_SELLER_PERSONA ?? "cooperative";

if (process.env.TRACE_FORCE_DETERMINISTIC === "1") {
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENAI_API_KEY;
}
process.env.NEGOTIATE_MAX_ROUNDS = String(maxRounds);

const C = {
  reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m",
  buy: "\x1b[36m", sell: "\x1b[35m", sys: "\x1b[33m", ok: "\x1b[32m",
};
const line = (c: string, s: string) => console.log(`${c}${s}${C.reset}`);
const sep = () => line(C.dim, "────────────────────────────────────────────────────────────");

async function postJson<T extends Record<string, any>>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return res.json() as Promise<T>;
}

async function main() {
  const sys = await startSystem();
  sep();
  line(C.sys, "STEP 0  · system booted (intake :3001 · negotiate :3002 · chain :3003)");
  sep();

  const seller = await postJson<{ offerId: string; matched: boolean }>("http://localhost:3001/offers", {
    resource: "gpu", unit: "hour", unitPrice: offerPrice, terms: "per-hour billing",
    requirements: { cuda: "13.0", gpu: "H200" },
    agentRegistry: registry,
    agentId: "GPUVendorAlpha", wallet: sellerWallet, pulseMinutes: 145,
  });
  const buyer = await postJson<{ intentId: string; matched: boolean; wssUrl: string }>("http://localhost:3001/intents", {
    resource: "gpu", qty: 1, unit: "hour", maxUnitPrice: buyerPrice,
    requirements: { cuda: "13.0", gpu: "H200" },
    agentRegistry: registry,
    agentId: "ResearchBot", wallet: buyerWallet,
  });
  line(C.sys, `STEP 1  · seller offer posted   -> ${seller.offerId} (pulse ${seller.matched ? "matched-immediately" : "waiting"})`);
  line(C.sys, `STEP 1  · buyer intent posted  -> ${buyer.intentId} matched=${buyer.matched}`);
  line(C.sys, `          match room: ${buyer.wssUrl}`);
  sep();

  const mk = (role: "buyer" | "seller", price: number): AgentDeps => ({
    wsUrl: buyer.wssUrl,
    role,
    identity: { agentRegistry: registry, agentId: role === "buyer" ? "ResearchBot" : "GPUVendorAlpha", wallet: role === "buyer" ? buyerWallet : sellerWallet },
    ctx: {
      price,
      qty: 1,
      terms: "per-hour billing",
      requirements: {},
      maxRounds,
      minDelta: 0.01,
      seed: 42,
      persona: role === "buyer" ? buyerPersona : sellerPersona,
    },
    opts: {
      timeoutMs,
      log: (s) => {
        // Re-label raw agent logs into clear steps.
        if (s.includes("joined room")) line(role === "buyer" ? C.buy : C.sell, `STEP 2  · ${role} joined the room`);
        else if (s.includes("decides:")) {
          const m = s.match(/decides: (\w+)( [\d.]+)? — (.+)/);
          if (m) line(role === "buyer" ? C.buy : C.sell, `STEP 4  · ${role} decides → ${m[1].toUpperCase()} ${m[2] ?? ""}\n          reasoning: "${m[3]}"`);
        } else if (s.includes("system: deal-closed")) line(C.ok, `STEP 5  · ${role} received deal-closed`);
        else if (s.includes("system: constraint-hit")) line(C.sys, `STEP 5  · ${role} received constraint-hit`);
        else if (s.includes("guard")) line(C.sys, `          guardrail: ${s}`);
        else line(role === "buyer" ? C.buy : C.sell, `          ${s}`);
      },
    },
  });

  line(C.sys, "STEP 3  · buyer+ seller connect; server emits 'room ready — buyer to move'");
  sep();
  const [b, s] = await Promise.all([runAgent(mk("buyer", buyerPrice)), runAgent(mk("seller", sellerFloor))]);
  sep();
  line(C.ok, `STEP 6  · RESULT  buyer=${b.kind}  seller=${s.kind}`);
  if (b.kind === "deal-closed") {
    line(C.ok, `          price=${b.unitPrice}  qty=${b.qty}  total=${(b.unitPrice ?? 0) * (b.qty ?? 0)} USDC`);
    line(C.ok, `          transcriptHash=${b.transcriptHash}`);
    line(C.dim, "          (identical hash on both sides = tamper-proof proof of the negotiation)");
  } else {
    line(C.sys, `          no deal closed after incompatible bounds: buyerMax=${buyerPrice}, sellerFloor=${sellerFloor}, maxRounds=${maxRounds}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await sys.close();
  process.exit(b.kind === "deal-closed" || (expectNoDeal && b.kind === "constraint-hit") ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
