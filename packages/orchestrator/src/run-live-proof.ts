/**
 * Finality — LIVE on-chain proof (GOAT Network).
 *
 * Runs the full deal loop against the REAL chain service in CHAIN_MODE=live:
 *   intent -> match -> negotiate -> deal -> ON-CHAIN settle (real txHash) -> reputation.
 *
 * Preconditions (see .env.example):
 *   CHAIN_MODE=live, GOAT_NETWORK, GOAT_PRIVATE_KEY (funded), optional GOAT_SETTLE_TOKEN.
 * Run:
 *   npm -w packages/orchestrator run proof:live
 *   (which is: tsx --env-file=../../.env src/run-live-proof.ts)
 *
 * SAFETY: keep totals SMALL. This moves real (testnet) value. The Safety
 * Transformer still gates the total against DEFAULT_POLICY.maxSingleTrade ($50),
 * so keep unitPrice*qty <= 50 or the deal is blocked (which is itself a valid
 * proof of the safety gate).
 */
import { startSystem } from "./start-all.js";
import { negotiate, type NegotiationPolicy, type PartyIdentity } from "../../reference-agent/src/negotiate.js";
import { loadChainConfig, isLiveReady } from "../../chain/src/config.js";

const REG = "eip155:48816:0x556089008Fc0a60cD09390Eca93477ca254A5522";
const HTTP = "http://localhost:3001";

async function postJson(url: string, body: unknown): Promise<any> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`POST ${url} -> ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  const cfg = loadChainConfig();
  const check = isLiveReady(cfg);
  console.log(`Chain config: mode=${cfg.mode} network=${cfg.network} rpc=${cfg.rpcUrl}`);
  if (!check.ready) {
    console.error(`\n❌ Not live-ready: ${check.reason}`);
    console.error("   Fill .env from .env.example (CHAIN_MODE=live + GOAT_PRIVATE_KEY) and retry.");
    process.exit(1);
  }

  const sys = await startSystem();
  console.log("✅ System booted (intake:3001, negotiate:3002, chain:3003)\n");

  // Small amounts: 2 units @ $10 = $20 total (< $50 safety cap).
  const buyerId: PartyIdentity = { agentRegistry: REG, agentId: "LiveBuyer", wallet: "0x000000000000000000000000000000000000dEaD" };
  // Seller wallet MUST be a real address you control on GOAT to receive funds.
  const sellerWallet = process.env.GOAT_SELLER_WALLET ?? "0x000000000000000000000000000000000000bEEF";
  const sellerId: PartyIdentity = { agentRegistry: REG, agentId: "LiveSeller", wallet: sellerWallet };

  const intent = await postJson(`${HTTP}/intents`, {
    resource: "gpu", qty: 2, unit: "hour", maxUnitPrice: 10, requirements: { gpu: "H100" }, ...buyerId,
  });
  console.log("1. Buyer intent:", intent.intentId);
  const offer = await postJson(`${HTTP}/offers`, {
    resource: "gpu", unit: "hour", unitPrice: 8, terms: "per-hour", requirements: { gpu: "H100" }, ...sellerId,
  });
  console.log("2. Seller offer:", offer.offerId);

  const match = intent.matched ? intent : offer.matched ? offer : null;
  if (!match?.matched) throw new Error("no match");
  console.log(`3. MATCHED -> ${match.roomId}\n`);

  const buyerPolicy: NegotiationPolicy = { role: "buyer", price: 10, qty: 2, terms: "per-hour", requirements: { gpu: "H100" } };
  const sellerPolicy: NegotiationPolicy = { role: "seller", price: 8, qty: 2, terms: "per-hour", requirements: { gpu: "H100" } };
  const [b] = await Promise.all([
    negotiate(match.wssUrl, buyerPolicy, buyerId, { timeoutMs: 15000, log: (s) => console.log("  b:", s) }),
    negotiate(match.wssUrl, sellerPolicy, sellerId, { timeoutMs: 15000, log: (s) => console.log("  s:", s) }),
  ]);
  console.log(`\n4/5. Negotiation: ${b.kind} @ $${b.unitPrice} x ${b.qty}`);
  if (b.kind !== "deal-closed") throw new Error("deal did not close");

  // The negotiate service auto-POSTs the deal to chain :3003; give it a moment,
  // then read the ledger back. But to capture the live txHash we POST directly.
  const dealResult = await postJson("http://localhost:3003/deals", {
    roomId: match.roomId,
    transcriptHash: b.transcriptHash,
    buyer: buyerId,
    seller: sellerId,
    unitPrice: b.unitPrice,
    qty: b.qty,
    terms: b.terms,
    totalUsdc: (b.unitPrice ?? 0) * (b.qty ?? 0),
  });

  console.log("\n6. Settlement:");
  console.log("   mode:    ", dealResult.mode);
  console.log("   txHash:  ", dealResult.txHash);
  if (dealResult.explorerUrl) console.log("   explorer:", dealResult.explorerUrl);
  console.log("   reputation:", JSON.stringify(dealResult.reputation));

  if (dealResult.mode !== "live") throw new Error("expected live settlement");
  console.log("\n✅ LIVE PROOF PASS: real on-chain settlement with txHash.");
  await sys.close();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("\n❌ LIVE PROOF FAIL:", e.message);
  process.exit(1);
});
