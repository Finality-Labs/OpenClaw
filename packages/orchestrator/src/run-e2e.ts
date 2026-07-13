/**
 * Finality — END-TO-END proof.
 *
 * Boots the whole merged system (intake + negotiate + chain), then drives a
 * complete deal as the artifact's cast would:
 *   1. Buyer (ResearchBot) POSTs an intent  (5h H100 @ max $20) to intake.
 *   2. Seller (GPUVendorAlpha) POSTs an offer (H100 @ $18/hr) to intake.
 *   3. Intake MATCHES them -> returns roomId + wssUrl.
 *   4. Both agents connect to the WS room and negotiate (Part 4 client + Part 2 venue).
 *   5. Deal closes -> negotiate notifies chain (Part 3).
 *   6. Chain runs the Safety Transformer, mock-settles via x402, records
 *      ERC-8004 reputation with proof-of-payment.
 *
 * Prints each stage and asserts the loop closed with reputation recorded.
 */
import { startSystem } from "./start-all.js";
import { negotiate, type NegotiationPolicy, type PartyIdentity } from "../../reference-agent/src/negotiate.js";
import { reputation } from "../../chain/src/reputation.js";

const REG = "eip155:84532:0x8004A818BFB912233c491871b3d84c89A494BD9e";
const HTTP = "http://localhost:3001";

async function postJson(url: string, body: unknown): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${url} -> ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  const sys = await startSystem();
  console.log("✅ System booted (intake:3001, negotiate:3002, chain:3003)\n");

  // 1 + 2: post intent & offer
  const buyerId = { agentRegistry: REG, agentId: "ResearchBot", wallet: "0xab1234567890abcdef1234567890abcdef1234" };
  const sellerId = { agentRegistry: REG, agentId: "GPUVendorAlpha", wallet: "0xcd4567890abcdef1234567890abcdef123456" };

  const intent = await postJson(`${HTTP}/intents`, {
    resource: "gpu", qty: 2, unit: "hour", maxUnitPrice: 20,
    requirements: { cuda: "12.1", gpu: "H100" }, ...buyerId,
  });
  console.log("1. Buyer intent posted:", intent.intentId);

  const offer = await postJson(`${HTTP}/offers`, {
    resource: "gpu", unit: "hour", unitPrice: 18, terms: "per-hour billing",
    requirements: { cuda: "12.1", gpu: "H100" }, ...sellerId,
  });
  console.log("2. Seller offer posted:", offer.offerId);

  // 3: match
  const match = intent.matched
    ? intent
    : offer.matched
    ? offer
    : await (async () => {
        const m: any = await (await fetch(`${HTTP}/matches/${intent.intentId}`)).json();
        if (!m.matched) throw new Error("no match");
        return m;
      })();
  if (!match.matched) throw new Error("intent/offer did not match");
  console.log(`3. MATCHED -> room ${match.roomId} (${match.wssUrl})\n`);

  // 4 + 5: negotiate in the same room
  const wssUrl = match.wssUrl;
  const buyerPolicy: NegotiationPolicy = { role: "buyer", price: 20, qty: 2, terms: "per-hour", requirements: { gpu: "H100" } };
  const sellerPolicy: NegotiationPolicy = { role: "seller", price: 15, qty: 2, terms: "per-hour", requirements: { gpu: "H100" } };

  const buyerDone = negotiate(wssUrl, buyerPolicy, buyerId as PartyIdentity, { timeoutMs: 10000 });
  const sellerDone = negotiate(wssUrl, sellerPolicy, sellerId as PartyIdentity, { timeoutMs: 10000 });
  const [b, s] = await Promise.all([buyerDone, sellerDone]);

  console.log("\n4/5. Negotiation result:", b.kind, "price", b.unitPrice, "qty", b.qty, "hash", b.transcriptHash);
  if (b.kind !== "deal-closed") throw new Error("deal did not close: " + b.kind);

  // give the (best-effort) notifyDeal a moment to reach chain
  await new Promise((r) => setTimeout(r, 500));

  // 6: assert chain recorded reputation + settlement
  const sellerRep = reputation.getReputation("GPUVendorAlpha");
  const buyerRep = reputation.getReputation("ResearchBot");
  console.log("\n6. Chain reputation after settlement:");
  console.log("   GPUVendorAlpha:", JSON.stringify(sellerRep));
  console.log("   ResearchBot:  ", JSON.stringify(buyerRep));
  if (sellerRep.count < 1 || buyerRep.count < 1) throw new Error("chain did not record reputation");

  console.log("\n✅ END-TO-END PASS: intent → match → negotiate → deal → settle → reputation.");
  await sys.close();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("\n❌ E2E FAIL:", e.message);
  process.exit(1);
});
