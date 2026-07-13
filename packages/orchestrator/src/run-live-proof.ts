/**
 * Finality — LIVE on-chain proof (GOAT Network), FULL loop incl. ERC-8004.
 *
 * Runs against the REAL chain service in CHAIN_MODE=live:
 *   0. Register buyer + seller on ERC-8004 Identity Registry -> numeric agentIds.
 *   1-3. intent -> match.
 *   4-5. negotiate -> deal.
 *   6. ON-CHAIN settle (real txHash) + ERC-8004 giveFeedback/getSummary.
 *
 * Preconditions (see .env.example):
 *   CHAIN_MODE=live, GOAT_NETWORK, GOAT_PRIVATE_KEY (funded), optional GOAT_SETTLE_TOKEN.
 *   GOAT_SELLER_WALLET (real address you control) to receive the settlement.
 *   GOAT_AGENT_URI (optional) — the agent registration JSON URI; a placeholder is used otherwise.
 * Run:
 *   npm -w packages/orchestrator run proof:live
 *
 * SAFETY: keep totals SMALL. DEFAULT_POLICY.maxSingleTrade=$50 gates the total;
 * unitPrice*qty must be <= 50 or the deal is blocked (a valid safety proof too).
 */
import { startSystem } from "./start-all.js";
import { negotiate, type NegotiationPolicy, type PartyIdentity } from "../../reference-agent/src/negotiate.js";
import { loadChainConfig, isLiveReady } from "../../chain/src/config.js";

const REG = "eip155:48816:0x556089008Fc0a60cD09390Eca93477ca254A5522";
const HTTP = "http://localhost:3001";
const CHAIN = "http://localhost:3003";
const AGENT_URI = process.env.GOAT_AGENT_URI ?? "https://finality.example/agent.json";

async function postJson(url: string, body: unknown): Promise<any> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${url} -> ${res.status} ${text}`);
  return JSON.parse(text);
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

  // 0. Register both agents on-chain (ERC-8004) -> numeric agentIds for feedback.
  console.log("0. Registering agents on ERC-8004 Identity Registry…");
  const buyerReg = await postJson(`${CHAIN}/register`, { agentURI: `${AGENT_URI}#buyer` });
  console.log(`   buyer  agentId=${buyerReg.agentId} tx=${buyerReg.txHash}`);
  const sellerReg = await postJson(`${CHAIN}/register`, { agentURI: `${AGENT_URI}#seller` });
  console.log(`   seller agentId=${sellerReg.agentId} tx=${sellerReg.txHash}\n`);

  const sellerWallet = process.env.GOAT_SELLER_WALLET ?? "0x000000000000000000000000000000000000bEEF";
  const buyerId: PartyIdentity = { agentRegistry: REG, agentId: "LiveBuyer", wallet: "0x000000000000000000000000000000000000dEaD" };
  const sellerId: PartyIdentity = { agentRegistry: REG, agentId: "LiveSeller", wallet: sellerWallet };

  // 1-3. intent + offer -> match. Small amounts: 2 @ $10 = $20 (< $50 cap).
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

  // 4-5. negotiate to close.
  const buyerPolicy: NegotiationPolicy = { role: "buyer", price: 10, qty: 2, terms: "per-hour", requirements: { gpu: "H100" } };
  const sellerPolicy: NegotiationPolicy = { role: "seller", price: 8, qty: 2, terms: "per-hour", requirements: { gpu: "H100" } };
  const [b] = await Promise.all([
    negotiate(match.wssUrl, buyerPolicy, buyerId, { timeoutMs: 15000, log: (s) => console.log("  b:", s) }),
    negotiate(match.wssUrl, sellerPolicy, sellerId, { timeoutMs: 15000, log: (s) => console.log("  s:", s) }),
  ]);
  console.log(`\n4/5. Negotiation: ${b.kind} @ $${b.unitPrice} x ${b.qty}`);
  if (b.kind !== "deal-closed") throw new Error("deal did not close");

  // 6. Settle on-chain + record ERC-8004 reputation (pass numeric agentIds).
  const dealResult = await postJson(`${CHAIN}/deals`, {
    roomId: match.roomId,
    transcriptHash: b.transcriptHash,
    buyer: { ...buyerId, onchainAgentId: buyerReg.agentId },
    seller: { ...sellerId, onchainAgentId: sellerReg.agentId },
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
  console.log("\n✅ LIVE PROOF PASS: on-chain register + settle + ERC-8004 reputation.");
  await sys.close();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("\n❌ LIVE PROOF FAIL:", e.message);
  process.exit(1);
});
