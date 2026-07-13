#!/usr/bin/env node
/**
 * @finality/reference-agent — minimal reference client proving the
 * finality-agent-skill works end to end from an agent's perspective.
 *
 *   Buyer:  POST intent -> poll match -> WS connect as buyer -> negotiate -> done
 *   Seller: POST offer  -> poll match -> WS connect as seller -> negotiate -> done
 *
 * Settlement/reputation is handled by the platform (Part 3); this client stops
 * on `system: deal-closed`.
 */
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { negotiate, type NegotiationPolicy, type Role } from "./negotiate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// schemas live at repo root: <root>/contracts/schemas
const SCHEMA_ROOT = resolve(__dirname, "../../../contracts/schemas");

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

function loadSchema(name: string) {
  const raw = JSON.parse(readFileSync(resolve(SCHEMA_ROOT, name), "utf8"));
  delete raw.$schema; // ajv defaults to draft-07; strip 2020-12 declaration
  return raw;
}
const intentValidator = ajv.compile(loadSchema("intent.json"));
const offerValidator = ajv.compile(loadSchema("offer.json"));

interface CliArgs {
  role: Role;
  resource: string;
  qty: number;
  price: number;
  unit: string;
  terms: string;
  requirements: Record<string, unknown>;
  server: string;
  ws: string;
  agentId: string;
  wallet: string;
  registry: string;
  hardMax?: number;
  timeoutMs: number;
}

function parseArgs(argv: string[]): CliArgs {
  const a: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith("--")) a[k.slice(2)] = argv[++i] ?? "";
  }
  const role = (a.role === "seller" ? "seller" : "buyer") as Role;
  if (!a.agentId || !a.wallet || !a.registry) {
    throw new Error("Missing required --agentId, --wallet, --registry");
  }
  if (!/^0x[a-fA-F0-9]+$/.test(a.wallet)) throw new Error("Invalid --wallet (must be 0x…)");
  if (!/^eip155:/.test(a.registry)) throw new Error("Invalid --registry (must be eip155:…)");
  return {
    role,
    resource: a.resource ?? "gpu",
    qty: Number(a.qty ?? 1),
    price: Number(a.price ?? (role === "buyer" ? 20 : 18)),
    unit: a.unit ?? "hour",
    terms: a.terms ?? "per-hour billing, cancel anytime",
    requirements: a.requirements ? JSON.parse(a.requirements) : { cuda: "12.1", gpu: "H100" },
    server: a.server ?? process.env.FINALITY_HTTP ?? "http://localhost:3001",
    ws: a.ws ?? process.env.FINALITY_WS ?? "ws://localhost:3002",
    agentId: a.agentId,
    wallet: a.wallet,
    registry: a.registry,
    hardMax: a.hardMax ? Number(a.hardMax) : undefined,
    timeoutMs: Number(a.timeout ?? 30000),
  };
}

async function postJson(url: string, body: unknown): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${url} -> ${res.status} ${await res.text()}`);
  return res.json();
}

async function pollMatch(server: string, id: string): Promise<{ roomId: string; wssUrl: string }> {
  for (let i = 0; i < 60; i++) {
    const m: any = await (await fetch(`${server}/matches/${id}`)).json();
    if (m.matched) return { roomId: m.roomId, wssUrl: m.wssUrl };
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("timed out waiting for a match");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const identity = {
    agentRegistry: args.registry,
    agentId: args.agentId,
    wallet: args.wallet,
  };

  let id: string;
  let body: any;
  if (args.role === "buyer") {
    body = {
      resource: args.resource,
      qty: args.qty,
      unit: args.unit,
      maxUnitPrice: args.price,
      requirements: args.requirements,
      ...identity,
    };
    if (!intentValidator(body)) {
      throw new Error("Intent failed schema validation: " + ajv.errorsText(intentValidator.errors));
    }
    const r = await postJson(`${args.server}/intents`, body);
    id = r.intentId;
    console.log(`[buyer] posted intent ${id}`);
    if (r.matched) {
      console.log(`[buyer] matched immediately: ${r.wssUrl}`);
      return runNegotiation(r.wssUrl, args);
    }
  } else {
    body = {
      resource: args.resource,
      unit: args.unit,
      unitPrice: args.price,
      terms: args.terms,
      requirements: args.requirements,
      ...identity,
    };
    if (!offerValidator(body)) {
      throw new Error("Offer failed schema validation: " + ajv.errorsText(offerValidator.errors));
    }
    const r = await postJson(`${args.server}/offers`, body);
    id = r.offerId;
    console.log(`[seller] posted offer ${id}`);
    if (r.matched) {
      console.log(`[seller] matched immediately: ${r.wssUrl}`);
      return runNegotiation(r.wssUrl, args);
    }
  }

  console.log(`[${args.role}] polling for match…`);
  const match = await pollMatch(args.server, id);
  console.log(`[${args.role}] matched: ${match.wssUrl}`);
  return runNegotiation(match.wssUrl, args);
}

async function runNegotiation(wssUrl: string, args: CliArgs) {
  const policy: NegotiationPolicy = {
    role: args.role,
    price: args.price,
    qty: args.qty,
    terms: args.terms,
    requirements: args.requirements,
    hardMax: args.hardMax,
  };
  const identity = {
    agentRegistry: args.registry,
    agentId: args.agentId,
    wallet: args.wallet,
  };
  const result = await negotiate(wssUrl, policy, identity, {
    timeoutMs: args.timeoutMs,
    log: (s) => console.log(`  ${s}`),
  });
  if (result.kind === "deal-closed") {
    console.log(`\n✅ DEAL CLOSED: ${result.unitPrice} ${args.unit} x ${result.qty} = ${
      (result.unitPrice ?? 0) * (result.qty ?? 0)
    } USDC`);
    console.log(`   terms: ${result.terms}`);
    process.exit(0);
  } else {
    console.log(`\n⚠️  NO DEAL (constraint-hit / closed)`);
    process.exit(2);
  }
}

main().catch((e) => {
  console.error("error:", e.message);
  process.exit(1);
});
