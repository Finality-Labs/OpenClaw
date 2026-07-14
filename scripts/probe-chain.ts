import { startSystem } from "../packages/orchestrator/src/start-all.js";

async function main() {
  const sys = await startSystem();
  await new Promise((r) => setTimeout(r, 500));
  const h = await fetch("http://localhost:3003/health").then((r) => r.json()).catch((e) => ({ err: String(e) }));
  console.log("chain /health:", JSON.stringify(h));
  const d = await fetch("http://localhost:3003/deals", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ roomId: "r", transcriptHash: "0x0", buyer: { agentRegistry: "eip155:1", agentId: "b", wallet: "0x11" }, seller: { agentRegistry: "eip155:1", agentId: "s", wallet: "0x22" }, unitPrice: 20, qty: 1, terms: "t", totalUsdc: 20 }),
  }).then((r) => r.status).catch((e) => "ERR:" + e);
  console.log("chain /deals POST status:", d);
  await sys.close();
  process.exit(0);
}
main();
