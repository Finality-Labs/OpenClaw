/**
 * Finality — UI control panel server.
 *
 * Boots the whole merged system (intake:3001, negotiate:3002, chain:3003) and
 * serves a browser dashboard on :3000 from which a human can:
 *   - post a buyer intent + seller offer to intake,
 *   - watch them match into a WS negotiation room,
 *   - run both reference agents to a deal-close,
 *   - see chain settlement + ERC-8004 reputation.
 *
 * The negotiation client (reference-agent) is a Node WebSocket client, so the
 * deal is driven server-side here and the result is returned to the browser as
 * JSON. The static page only collects parameters and renders the outcome.
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startSystem, type RunningSystem } from "./start-all.js";
import { negotiate, type NegotiationPolicy, type PartyIdentity } from "../../reference-agent/src/negotiate.js";
import { reputation } from "../../chain/src/reputation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const UI_PORT = Number(process.env.UI_PORT ?? 3000);
const HTTP = "http://localhost:3001";
const REG = "eip155:84532:0x8004A818BFB912233c491871b3d84c89A494BD9e";

// A demo-safe alphanumeric wallet (intake's regex rejects underscores).
function demoWallet(prefix: string): string {
  return `0x${prefix}${Math.random().toString(16).slice(2, 10)}${"0".repeat(24)}`.slice(0, 42);
}

async function postJson(url: string, body: unknown): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${url} -> ${res.status} ${text}`);
  return JSON.parse(text);
}

interface DealRequest {
  resource: string;
  qty: number;
  buyerMax: number;   // buyer ceiling per unit
  sellerFloor: number; // seller floor per unit
  gpu?: string;
}

/** Run the whole intent -> match -> negotiate -> settle -> reputation loop. */
async function runDeal(req: DealRequest) {
  const log: string[] = [];
  const buyerId: PartyIdentity = { agentRegistry: REG, agentId: "ResearchBot", wallet: demoWallet("ab") };
  const sellerId: PartyIdentity = { agentRegistry: REG, agentId: "GPUVendorAlpha", wallet: demoWallet("cd") };
  const requirements = req.gpu ? { gpu: req.gpu } : {};

  const intent = await postJson(`${HTTP}/intents`, {
    resource: req.resource, qty: req.qty, unit: "hour", maxUnitPrice: req.buyerMax,
    requirements, ...buyerId,
  });
  log.push(`Buyer intent posted: ${intent.intentId}`);

  const offer = await postJson(`${HTTP}/offers`, {
    resource: req.resource, unit: "hour", unitPrice: req.sellerFloor, terms: "per-hour billing",
    requirements, ...sellerId,
  });
  log.push(`Seller offer posted: ${offer.offerId}`);

  const match = intent.matched ? intent : offer.matched ? offer : null;
  if (!match || !match.matched) {
    log.push("No match — buyer max is below seller floor, or resource/requirements differ.");
    return { matched: false, log };
  }
  log.push(`MATCHED -> room ${match.roomId}`);

  const buyerPolicy: NegotiationPolicy = { role: "buyer", price: req.buyerMax, qty: req.qty, terms: "per-hour", requirements };
  const sellerPolicy: NegotiationPolicy = { role: "seller", price: req.sellerFloor, qty: req.qty, terms: "per-hour", requirements };

  const [b] = await Promise.all([
    negotiate(match.wssUrl, buyerPolicy, buyerId, { timeoutMs: 10000, log: (s) => log.push(`buyer: ${s}`) }),
    negotiate(match.wssUrl, sellerPolicy, sellerId, { timeoutMs: 10000, log: (s) => log.push(`seller: ${s}`) }),
  ]);

  log.push(`Negotiation: ${b.kind}${b.unitPrice != null ? ` @ $${b.unitPrice}/unit x ${b.qty}` : ""}`);
  await new Promise((r) => setTimeout(r, 400)); // let chain settle

  const buyerRep = reputation.getReputation("ResearchBot");
  const sellerRep = reputation.getReputation("GPUVendorAlpha");

  return {
    matched: true,
    result: b,
    total: b.unitPrice != null ? b.unitPrice * (b.qty ?? 0) : null,
    reputation: { ResearchBot: buyerRep, GPUVendorAlpha: sellerRep },
    log,
  };
}

async function main() {
  const sys: RunningSystem = await startSystem();
  const indexHtml = readFileSync(join(__dirname, "..", "public", "index.html"), "utf8");

  const server = createServer(async (httpReq, httpRes) => {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
    };
    if (httpReq.method === "OPTIONS") { httpRes.writeHead(204, cors); return httpRes.end(); }

    if (httpReq.url === "/" || httpReq.url === "/index.html") {
      httpRes.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return httpRes.end(indexHtml);
    }

    if (httpReq.url === "/api/run-deal" && httpReq.method === "POST") {
      let body = "";
      httpReq.on("data", (c) => (body += c));
      httpReq.on("end", async () => {
        try {
          const parsed = JSON.parse(body || "{}");
          const out = await runDeal({
            resource: parsed.resource || "gpu",
            qty: Number(parsed.qty) || 1,
            buyerMax: Number(parsed.buyerMax),
            sellerFloor: Number(parsed.sellerFloor),
            gpu: parsed.gpu || undefined,
          });
          httpRes.writeHead(200, { "content-type": "application/json", ...cors });
          httpRes.end(JSON.stringify(out));
        } catch (e: any) {
          httpRes.writeHead(500, { "content-type": "application/json", ...cors });
          httpRes.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    if (httpReq.url === "/api/health") {
      httpRes.writeHead(200, { "content-type": "application/json", ...cors });
      return httpRes.end(JSON.stringify({ ok: true, services: { intake: 3001, negotiate: 3002, chain: 3003 } }));
    }

    httpRes.writeHead(404, { "content-type": "application/json", ...cors });
    httpRes.end(JSON.stringify({ error: "not found" }));
  });

  server.listen(UI_PORT, () => {
    console.log("[ui] Finality control panel:");
    console.log(`  UI        http://localhost:${UI_PORT}`);
    console.log("  intake    http://localhost:3001");
    console.log("  negotiate ws://localhost:3002/negotiate/:roomId");
    console.log("  chain     http://localhost:3003");
    console.log("Press Ctrl+C to stop.");
  });

  const stop = () => { server.close(); sys.close().then(() => process.exit(0)); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((e) => { console.error(e); process.exit(1); });
