/**
 * Live sandbox test: boot the FULL Finality system (intake + negotiate + chain)
 * and drive two brain-backed agents (buyer + seller) through a real match →
 * negotiate → settle. No mocked server, no subagents — one process, real flow.
 *
 * Run: npx tsx scripts/live-brain-e2e.ts  (from repo root)
 */
import { startSystem } from "../packages/orchestrator/src/start-all.js";
import { runAgent, type AgentDeps } from "../packages/negotiate-brain/src/agent.js";
import { NegotiationBrain } from "../packages/negotiate-brain/src/brain.js";

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await res.text();
  console.log(`  [http ${res.status}] ${url} -> ${text.slice(0, 200)}`);
  if (!text) throw new Error(`empty response ${res.status} from ${url}`);
  return JSON.parse(text);
}

async function main() {
  const sys = await startSystem();
  console.log("[sandbox] system up: intake :3001  negotiate :3002  chain :3003");

  const seller = await post("http://localhost:3001/offers", {
    resource: "gpu", unit: "hour", unitPrice: 15, terms: "per-hour billing",
    requirements: { cuda: "13.0", gpu: "H200" },
    agentRegistry: "eip155:84532:0x8004A818BFB912233c491871b3d84c89A494BD9e",
    agentId: "GPUVendorAlpha", wallet: "0xSELLERLIVE1234", pulseMinutes: 145,
  });
  console.log("[sandbox] seller offer:", seller.offerId, "matched:", seller.matched);

  const buyer = await post("http://localhost:3001/intents", {
    resource: "gpu", qty: 1, unit: "hour", maxUnitPrice: 20,
    requirements: { cuda: "13.0", gpu: "H200" },
    agentRegistry: "eip155:84532:0x8004A818BFB912233c491871b3d84c89A494BD9e",
    agentId: "ResearchBot", wallet: "0xBUYERLIVE5678",
  });
  console.log("[sandbox] buyer intent:", buyer.intentId, "matched:", buyer.matched, "wssUrl:", buyer.wssUrl);

  const mk = (role: "buyer" | "seller", price: number, wssUrl: string): AgentDeps => ({
    wsUrl: wssUrl,
    role,
    identity: { agentRegistry: "eip155:84532:0x8004A818BFB912233c491871b3d84c89A494BD9e", agentId: role === "buyer" ? "ResearchBot" : "GPUVendorAlpha", wallet: role === "buyer" ? "0xBUYERLIVE5678" : "0xSELLERLIVE1234" },
    ctx: { price, qty: 1, terms: "per-hour billing", requirements: {}, maxRounds: 10, minDelta: 0.01, seed: 42 },
    opts: { timeoutMs: 10000, log: (s) => console.log(`  [${role}] ${s}`) },
  });

  const [b, s] = await Promise.all([
    runAgent(mk("buyer", 20, buyer.wssUrl)),
    runAgent(mk("seller", 15, buyer.wssUrl)),
  ]);

  console.log("\n[sandbox] RESULT buyer:", JSON.stringify(b));
  console.log("[sandbox] RESULT seller:", JSON.stringify(s));
  const ok = b.kind === "deal-closed" && s.kind === "deal-closed";
  console.log(ok ? "\n✅ LIVE SANDBOX PASS — deal closed + settled" : "\n❌ LIVE SANDBOX FAIL");
  await sys.close();
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
