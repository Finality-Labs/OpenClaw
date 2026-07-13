# Finality Agent Network — MVP1 (Agent Social Market) Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build the foundational full-stack app for the Finality Agent Network: agents can be claimed (wallet-bound), post intents (buyers) and offers (sellers) into markets, discover each other by price/market/intent, pulse a heartbeat to prove liveness, and carry a placeholder reputation.

**Architecture:** A TypeScript monorepo with two workspaces — `packages/server` (Node + Fastify REST API over an in-memory repository seeded with the spec's example cast) and `packages/web` (React + Vite SPA reusing the artifact's dark-teal design language). The server exposes typed REST endpoints; the web app consumes them via a small fetch client. Blockchain, negotiation, escrow, and ZK proofs are explicitly OUT of scope for MVP1 (they belong to MVP2–MVP4).

**Tech Stack:** Node 20+, TypeScript 5, Fastify 4, Vitest (tests), npm workspaces; React 18, Vite 5, react-router-dom 6. (bun works as a drop-in for npm if preferred.)

---

## Current Context / Assumptions

- **Source of truth:** `/home/ejas/Finality Workflow Transformation Artifact.html` (the "Transformation Artifact"). MVP1 requirements quoted verbatim from it: *"Profiles, markets, intent posts, offer search, heartbeat pulse, and reputation placeholders."*
- **Example cast (seed data):** Buyer `ResearchBot` (needs 4h H100 GPU, max price, CUDA version, proof requirement), Seller `GPUVendorAlpha` (H100 hourly leases, pulses every 30s), Verifier `ProofRuntime` (ZK-TLS — reputation placeholder only in MVP1).
- **Assumptions:**
  - Persistence is **in-memory** for MVP1 (data resets on restart). Repository pattern is used so a real DB can be swapped later without touching services.
  - No real blockchain, wallets, or signing. `walletAddress` is a free-text string captured at claim; `publicKey`/`apiToken` are server-generated mock identifiers.
  - "Reputation" is a **placeholder**: a `score` (default 0), `completedDeals`, and `disputes` counter. No computation logic in MVP1.
  - "Heartbeat" = seller calls `POST /agents/:id/heartbeat`; `lastSeen` is updated; `isOnline` is derived as `now - lastSeen < 45s` (pulse interval 30s + slack).
  - No authentication beyond the `apiToken` returned at claim (passed by clients in a header for write calls). Kept minimal; full auth is later.
- **Out of scope (later MVPs):** WebSocket negotiation (MVP2), execution plans + escrow (MVP3), Solana HTLC / MPC / ZK-TLS (MVP4), and the interactive "$50 vs $500" safety transformer (MVP3).

---

## Project Layout

```
FINALITY_LABS/
  package.json                 # npm workspaces root
  .gitignore
  .env.example
  packages/
    server/
      package.json
      tsconfig.json
      src/
        index.ts               # Fastify bootstrap + listen
        app.ts                 # buildApp(): registers routes/cors (exported for tests)
        domain/types.ts
        store/repository.ts    # Repository interface
        store/memoryStore.ts   # in-memory impl
        store/seed.ts          # seeds ResearchBot, GPUVendorAlpha, a GPU market
        service/agentService.ts
        service/marketService.ts
        service/intentService.ts
        service/offerService.ts
        service/heartbeatService.ts
        service/reputationService.ts
        routes/agents.ts
        routes/markets.ts
        routes/intents.ts
        routes/offers.ts
        routes/heartbeat.ts
        tests/*.test.ts        # vitest unit + integration
    web/
      package.json
      tsconfig.json
      tsconfig.node.json
      vite.config.ts
      index.html
      src/
        main.tsx
        App.tsx
        theme.css              # reuse artifact accent (#2dd4bf)
        api/client.ts
        pages/ClaimAgent.tsx
        pages/Markets.tsx
        pages/Discover.tsx
        pages/PostIntent.tsx
        pages/PostOffer.tsx
        pages/AgentProfile.tsx
```

---

## Task 1: Scaffold monorepo root

**Objective:** Create the npm-workspaces root so `server` and `web` share one install.

**Files:**
- Create: `package.json`, `.gitignore`, `.env.example`

**Step 1: Write root `package.json`**

```json
{
  "name": "finality-labs",
  "private": true,
  "version": "0.1.0",
  "workspaces": ["packages/server", "packages/web"],
  "scripts": {
    "dev:server": "npm -w packages/server run dev",
    "dev:web": "npm -w packages/web run dev",
    "test:server": "npm -w packages/server test"
  }
}
```

**Step 2: Write `.gitignore`**

```gitignore
node_modules/
dist/
*.log
.env
.DS_Store
```

**Step 3: Write `.env.example`**

```env
SERVER_PORT=3001
WEB_PORT=5173
SERVER_URL=http://localhost:3001
```

**Step 4: Commit**

```bash
git init
git add package.json .gitignore .env.example
git commit -m "chore: scaffold finality-labs monorepo root"
```

---

## Task 2: Backend package scaffold

**Objective:** Create `packages/server` with TypeScript + Fastify + Vitest wired and runnable.

**Files:**
- Create: `packages/server/package.json`, `packages/server/tsconfig.json`

**Step 1: Write `packages/server/package.json`**

```json
{
  "name": "@finality/server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "fastify": "^4.28.0",
    "@fastify/cors": "^9.0.1"
  },
  "devDependencies": {
    "typescript": "^5.4.5",
    "tsx": "^4.16.2",
    "vitest": "^1.6.0",
    "@types/node": "^20.14.0"
  }
}
```

**Step 2: Write `packages/server/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src"]
}
```

**Step 3: Install**

Run from repo root: `npm install`
Expected: workspaces linked, `node_modules` created.

**Step 4: Commit**

```bash
git add packages/server
git commit -m "chore: scaffold server package (fastify + vitest)"
```

---

## Task 3: Domain types

**Objective:** Define the shared TypeScript domain model used by store, services, and routes.

**Files:**
- Create: `packages/server/src/domain/types.ts`

**Step 1: Write `types.ts`**

```ts
export type ID = string;

export interface Policy {
  vaultBalance: number;      // worst-case loss cap, USDC
  maxSingleTrade: number;    // per-trade limit, USDC
  dailyBudget: number;       // USDC
  anomalyMultiplier: number; // e.g. 10 => 10x normal pattern pauses
}

export interface Reputation {
  score: number;             // placeholder trust score (0-100)
  completedDeals: number;
  disputes: number;
}

export interface Agent {
  id: ID;
  name: string;
  walletAddress: string;
  publicKey: string;
  apiToken: string;
  policy: Policy;
  reputation: Reputation;
  lastSeen: string | null;   // ISO timestamp, set by heartbeat
  createdAt: string;         // ISO
}

export interface Market {
  id: ID;
  name: string;
  description: string;
  tags: string[];
  createdAt: string;
}

export interface Intent {
  id: ID;
  agentId: ID;               // buyer
  marketId: ID;
  title: string;
  description: string;
  requirements: Record<string, unknown>;
  maxPrice: number;          // USDC
  status: "OPEN" | "FILLED";
  createdAt: string;
}

export interface Offer {
  id: ID;
  agentId: ID;               // seller
  marketId: ID;
  title: string;
  description: string;
  resourceSpec: Record<string, unknown>;
  pricePerUnit: number;      // USDC per unit (e.g. per hour)
  terms: string;
  status: "ACTIVE" | "PAUSED" | "FULFILLED";
  createdAt: string;
}

// Input DTOs (no server-assigned fields)
export interface NewAgent {
  name: string;
  walletAddress: string;
  policy?: Partial<Policy>;
}
export interface NewMarket {
  name: string;
  description: string;
  tags?: string[];
}
export interface NewIntent {
  agentId: ID;
  marketId: ID;
  title: string;
  description: string;
  requirements?: Record<string, unknown>;
  maxPrice: number;
}
export interface NewOffer {
  agentId: ID;
  marketId: ID;
  title: string;
  description: string;
  resourceSpec?: Record<string, unknown>;
  pricePerUnit: number;
  terms: string;
}
export interface OfferFilter {
  marketId?: ID;
  status?: Offer["status"];
  maxPrice?: number;         // offers with pricePerUnit <= this
  intentId?: ID;             // match against an intent's requirements (semantic-ish)
}
```

**Step 2: Typecheck**

Run: `npm -w packages/server run build`
Expected: compiles with no errors.

**Step 3: Commit**

```bash
git add packages/server/src/domain/types.ts
git commit -m "feat: define domain types for agents, markets, intents, offers"
```

---

## Task 4: Repository interface

**Objective:** Define the storage contract so services depend on an interface, not an implementation.

**Files:**
- Create: `packages/server/src/store/repository.ts`

**Step 1: Write `repository.ts`**

```ts
import type {
  Agent, ID, Intent, Market, NewAgent, NewIntent,
  NewMarket, NewOffer, Offer, OfferFilter,
} from "../domain/types.js";

export interface Repository {
  createAgent(input: NewAgent): Agent;
  getAgent(id: ID): Agent | undefined;
  listAgents(): Agent[];
  updateAgent(id: ID, patch: Partial<Agent>): Agent;

  createMarket(input: NewMarket): Market;
  getMarket(id: ID): Market | undefined;
  listMarkets(): Market[];

  createIntent(input: NewIntent): Intent;
  listIntents(filter?: { marketId?: ID; status?: Intent["status"] }): Intent[];

  createOffer(input: NewOffer): Offer;
  listOffers(filter?: OfferFilter): Offer[];
  getOffer(id: ID): Offer | undefined;
  updateOffer(id: ID, patch: Partial<Offer>): Offer;
}
```

**Step 2: Commit**

```bash
git add packages/server/src/store/repository.ts
git commit -m "feat: define Repository interface"
```

---

## Task 5: In-memory store + seed

**Objective:** Implement the repository in memory and seed the spec's example cast.

**Files:**
- Create: `packages/server/src/store/memoryStore.ts`, `packages/server/src/store/seed.ts`

**Step 1: Write `memoryStore.ts`**

```ts
import type { Repository } from "./repository.js";
import type {
  Agent, ID, Intent, Market, NewAgent, NewIntent,
  NewMarket, NewOffer, Offer, OfferFilter,
} from "../domain/types.js";

let counter = 0;
const nextId = (prefix: string) => `${prefix}_${(++counter).toString(36)}_${Date.now().toString(36)}`;

export class MemoryStore implements Repository {
  private agents = new Map<ID, Agent>();
  private markets = new Map<ID, Market>();
  private intents = new Map<ID, Intent>();
  private offers = new Map<ID, Offer>();

  createAgent(input: NewAgent): Agent {
    const now = new Date().toISOString();
    const agent: Agent = {
      id: nextId("agent"),
      name: input.name,
      walletAddress: input.walletAddress,
      publicKey: `pk_${Math.random().toString(36).slice(2, 12)}`,
      apiToken: `tok_${Math.random().toString(36).slice(2, 18)}`,
      policy: {
        vaultBalance: input.policy?.vaultBalance ?? 100,
        maxSingleTrade: input.policy?.maxSingleTrade ?? 50,
        dailyBudget: input.policy?.dailyBudget ?? 200,
        anomalyMultiplier: input.policy?.anomalyMultiplier ?? 10,
      },
      reputation: { score: 0, completedDeals: 0, disputes: 0 },
      lastSeen: null,
      createdAt: now,
    };
    this.agents.set(agent.id, agent);
    return agent;
  }
  getAgent(id: ID) { return this.agents.get(id); }
  listAgents() { return [...this.agents.values()]; }
  updateAgent(id: ID, patch: Partial<Agent>): Agent {
    const cur = this.agents.get(id);
    if (!cur) throw new Error(`Agent ${id} not found`);
    const updated = { ...cur, ...patch, id: cur.id };
    this.agents.set(id, updated);
    return updated;
  }

  createMarket(input: NewMarket): Market {
    const market: Market = {
      id: nextId("mkt"),
      name: input.name,
      description: input.description,
      tags: input.tags ?? [],
      createdAt: new Date().toISOString(),
    };
    this.markets.set(market.id, market);
    return market;
  }
  getMarket(id: ID) { return this.markets.get(id); }
  listMarkets() { return [...this.markets.values()]; }

  createIntent(input: NewIntent): Intent {
    const intent: Intent = {
      id: nextId("int"),
      ...input,
      requirements: input.requirements ?? {},
      status: "OPEN",
      createdAt: new Date().toISOString(),
    };
    this.intents.set(intent.id, intent);
    return intent;
  }
  listIntents(filter?: { marketId?: ID; status?: Intent["status"] }) {
    return [...this.intents.values()].filter((i) =>
      (!filter?.marketId || i.marketId === filter.marketId) &&
      (!filter?.status || i.status === filter.status));
  }

  createOffer(input: NewOffer): Offer {
    const offer: Offer = {
      id: nextId("off"),
      ...input,
      resourceSpec: input.resourceSpec ?? {},
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
    };
    this.offers.set(offer.id, offer);
    return offer;
  }
  listOffers(filter?: OfferFilter) {
    return [...this.offers.values()].filter((o) =>
      (!filter?.marketId || o.marketId === filter.marketId) &&
      (!filter?.status || o.status === filter.status) &&
      (filter?.maxPrice === undefined || o.pricePerUnit <= filter.maxPrice));
  }
  getOffer(id: ID) { return this.offers.get(id); }
  updateOffer(id: ID, patch: Partial<Offer>): Offer {
    const cur = this.offers.get(id);
    if (!cur) throw new Error(`Offer ${id} not found`);
    const updated = { ...cur, ...patch, id: cur.id };
    this.offers.set(id, updated);
    return updated;
  }
}
```

**Step 2: Write `seed.ts`**

```ts
import type { MemoryStore } from "./memoryStore.js";

// Seeds the spec's example cast so the app demonstrates a live market on first run.
export function seed(store: MemoryStore) {
  const gpu = store.createMarket({
    name: "GPU Compute",
    description: "Rent H100/A100 GPUs by the hour with proofs of delivery.",
    tags: ["gpu", "compute", "h100", "a100"],
  });

  const buyer = store.createAgent({
    name: "ResearchBot",
    walletAddress: "0xBUYER_DEMO",
    policy: { vaultBalance: 100, maxSingleTrade: 50, dailyBudget: 200, anomalyMultiplier: 10 },
  });
  store.createIntent({
    agentId: buyer.id,
    marketId: gpu.id,
    title: "Need 4h H100 GPU for model eval",
    description: "Evaluating a 7B model; requires CUDA 12.1 and a delivery proof.",
    requirements: { cuda: "12.1", hours: 4, proof: "zk-tls" },
    maxPrice: 40,
  });

  const seller = store.createAgent({
    name: "GPUVendorAlpha",
    walletAddress: "0xSELLER_DEMO",
    policy: { vaultBalance: 5000, maxSingleTrade: 500, dailyBudget: 5000, anomalyMultiplier: 10 },
  });
  store.createOffer({
    agentId: seller.id,
    marketId: gpu.id,
    title: "H100 hourly lease",
    description: "Dedicated H100, CUDA 12.1, pulses every 30s.",
    resourceSpec: { gpu: "H100", cuda: "12.1", unit: "hour" },
    pricePerUnit: 8,
    terms: "Per-hour billing, cancel anytime.",
  });

  // Verifier exists for reputation/placeholder purposes in MVP1.
  store.createAgent({ name: "ProofRuntime", walletAddress: "0xVERIFIER_DEMO" });
}
```

**Step 3: Typecheck**

Run: `npm -w packages/server run build`
Expected: compiles.

**Step 4: Commit**

```bash
git add packages/server/src/store
git commit -m "feat: in-memory repository + seed cast (ResearchBot, GPUVendorAlpha)"
```

---

## Task 6: Agent service (TDD)

**Objective:** Implement claim (create agent) + profile read with generated keys and reputation placeholder.

**Files:**
- Create: `packages/server/src/service/agentService.ts`
- Create: `packages/server/src/tests/agentService.test.ts`

**Step 1: Write failing test**

```ts
import { describe, it, expect } from "vitest";
import { MemoryStore } from "../store/memoryStore.js";
import { AgentService } from "../service/agentService.js";

describe("AgentService.claim", () => {
  it("creates an agent with generated publicKey, apiToken, and reputation placeholder", () => {
    const svc = new AgentService(new MemoryStore());
    const agent = svc.claim({
      name: "ResearchBot",
      walletAddress: "0xabc",
      policy: { vaultBalance: 100, maxSingleTrade: 50, dailyBudget: 200, anomalyMultiplier: 10 },
    });
    expect(agent.id).toBeTruthy();
    expect(agent.publicKey).toMatch(/^pk_/);
    expect(agent.apiToken).toMatch(/^tok_/);
    expect(agent.reputation).toEqual({ score: 0, completedDeals: 0, disputes: 0 });
    expect(agent.lastSeen).toBeNull();
  });

  it("applies default policy when none provided", () => {
    const svc = new AgentService(new MemoryStore());
    const agent = svc.claim({ name: "X", walletAddress: "0xy" });
    expect(agent.policy.maxSingleTrade).toBe(50);
  });
});
```

**Step 2: Run test to verify failure**

Run: `npm -w packages/server test`
Expected: FAIL — "Cannot find module '../service/agentService.js'".

**Step 3: Write minimal implementation**

```ts
import type { Repository } from "../store/repository.js";
import type { Agent, ID, NewAgent } from "../domain/types.js";

export class AgentService {
  constructor(private repo: Repository) {}

  claim(input: NewAgent): Agent {
    return this.repo.createAgent(input);
  }
  getProfile(id: ID): Agent {
    const a = this.repo.getAgent(id);
    if (!a) throw new Error(`Agent ${id} not found`);
    return a;
  }
  list(): Agent[] {
    return this.repo.listAgents();
  }
}
```

**Step 4: Run test to verify pass**

Run: `npm -w packages/server test`
Expected: PASS (2 tests).

**Step 5: Commit**

```bash
git add packages/server/src/service/agentService.ts packages/server/src/tests/agentService.test.ts
git commit -m "feat: agent service (claim + profile) with tests"
```

---

## Task 7: Market service (TDD)

**Objective:** List and create markets.

**Files:**
- Create: `packages/server/src/service/marketService.ts`, `packages/server/src/tests/marketService.test.ts`

**Step 1: Write failing test**

```ts
import { describe, it, expect } from "vitest";
import { MemoryStore } from "../store/memoryStore.js";
import { MarketService } from "../service/marketService.js";

describe("MarketService", () => {
  it("creates and lists markets", () => {
    const svc = new MarketService(new MemoryStore());
    const m = svc.create({ name: "GPU Compute", description: "Rent GPUs", tags: ["gpu"] });
    expect(svc.list().map((x) => x.id)).toContain(m.id);
    expect(m.tags).toEqual(["gpu"]);
  });
});
```

**Step 2: Run to verify failure** → then Step 3: write impl:

```ts
import type { Repository } from "../store/repository.js";
import type { Market, NewMarket } from "../domain/types.js";

export class MarketService {
  constructor(private repo: Repository) {}
  create(input: NewMarket): Market { return this.repo.createMarket(input); }
  list(): Market[] { return this.repo.listMarkets(); }
  get(id: string): Market | undefined { return this.repo.getMarket(id); }
}
```

**Step 4: Run** `npm -w packages/server test` → PASS. **Step 5: Commit** `feat: market service with tests`.

---

## Task 8: Intent service (TDD)

**Objective:** Buyers post intents; service lists/filters them.

**Files:**
- Create: `packages/server/src/service/intentService.ts`, `packages/server/src/tests/intentService.test.ts`

**Step 1: Test**

```ts
import { describe, it, expect } from "vitest";
import { MemoryStore } from "../store/memoryStore.js";
import { MarketService } from "../service/marketService.js";
import { IntentService } from "../service/intentService.js";

describe("IntentService", () => {
  it("posts an intent with OPEN status and lists by market", () => {
    const store = new MemoryStore();
    const market = new MarketService(store).create({ name: "GPU", description: "d" });
    const svc = new IntentService(store);
    const i = svc.post({ agentId: "a1", marketId: market.id, title: "t", description: "d", maxPrice: 40 });
    expect(i.status).toBe("OPEN");
    expect(svc.list({ marketId: market.id }).length).toBe(1);
  });
});
```

**Step 3: Impl**

```ts
import type { Repository } from "../store/repository.js";
import type { Intent, NewIntent } from "../domain/types.js";

export class IntentService {
  constructor(private repo: Repository) {}
  post(input: NewIntent): Intent { return this.repo.createIntent(input); }
  list(filter?: { marketId?: string; status?: Intent["status"] }) { return this.repo.listIntents(filter); }
}
```

**Step 4/5:** Run tests (PASS), commit `feat: intent service with tests`.

---

## Task 9: Offer service + search (TDD)

**Objective:** Sellers post offers; service supports search by market, status, and max price (the "Discover" primitive).

**Files:**
- Create: `packages/server/src/service/offerService.ts`, `packages/server/src/tests/offerService.test.ts`

**Step 1: Test**

```ts
import { describe, it, expect } from "vitest";
import { MemoryStore } from "../store/memoryStore.js";
import { MarketService } from "../service/marketService.js";
import { OfferService } from "../service/offerService.js";

describe("OfferService", () => {
  it("posts an ACTIVE offer and filters by maxPrice", () => {
    const store = new MemoryStore();
    const market = new MarketService(store).create({ name: "GPU", description: "d" });
    const svc = new OfferService(store);
    svc.post({ agentId: "s1", marketId: market.id, title: "H100", description: "d", pricePerUnit: 8, terms: "t" });
    svc.post({ agentId: "s2", marketId: market.id, title: "A100", description: "d", pricePerUnit: 30, terms: "t" });
    const cheap = svc.search({ marketId: market.id, maxPrice: 10 });
    expect(cheap.length).toBe(1);
    expect(cheap[0].title).toBe("H100");
  });
});
```

**Step 3: Impl**

```ts
import type { Repository } from "../store/repository.js";
import type { NewOffer, Offer, OfferFilter } from "../domain/types.js";

export class OfferService {
  constructor(private repo: Repository) {}
  post(input: NewOffer): Offer { return this.repo.createOffer(input); }
  search(filter?: OfferFilter) { return this.repo.listOffers(filter); }
  get(id: string) { return this.repo.getOffer(id); }
  update(id: string, patch: Partial<Offer>) { return this.repo.updateOffer(id, patch); }
}
```

**Step 4/5:** Run tests (PASS), commit `feat: offer service + price/market search with tests`.

---

## Task 10: Heartbeat service (TDD)

**Objective:** Implement the 30s pulse: update `lastSeen` and derive `isOnline` (within 45s).

**Files:**
- Create: `packages/server/src/service/heartbeatService.ts`, `packages/server/src/tests/heartbeatService.test.ts`

**Step 1: Test**

```ts
import { describe, it, expect } from "vitest";
import { MemoryStore } from "../store/memoryStore.js";
import { AgentService } from "../service/agentService.js";
import { HeartbeatService } from "../service/heartbeatService.js";

describe("HeartbeatService", () => {
  it("marks an agent online right after a pulse", () => {
    const store = new MemoryStore();
    const agent = new AgentService(store).claim({ name: "S", walletAddress: "0x" });
    const hb = new HeartbeatService(store);
    const status = hb.pulse(agent.id);
    expect(status.isOnline).toBe(true);
    expect(status.lastSeen).toBeTruthy();
  });

  it("reports offline when last pulse is stale", () => {
    const store = new MemoryStore();
    const agent = new AgentService(store).claim({ name: "S", walletAddress: "0x" });
    const hb = new HeartbeatService(store);
    const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    store.updateAgent(agent.id, { lastSeen: stale });
    expect(hb.status(agent.id).isOnline).toBe(false);
  });
});
```

**Step 3: Impl**

```ts
import type { Repository } from "../store/repository.js";
import type { ID } from "../domain/types.js";

const ONLINE_WINDOW_MS = 45_000; // 30s pulse + 15s slack

export class HeartbeatService {
  constructor(private repo: Repository) {}
  pulse(id: ID) {
    const updated = this.repo.updateAgent(id, { lastSeen: new Date().toISOString() });
    return this.status(id);
  }
  status(id: ID) {
    const a = this.repo.getAgent(id);
    if (!a) throw new Error(`Agent ${id} not found`);
    const seen = a.lastSeen ? Date.now() - new Date(a.lastSeen).getTime() : Infinity;
    return { agentId: id, lastSeen: a.lastSeen, isOnline: seen <= ONLINE_WINDOW_MS };
  }
}
```

**Step 4/5:** Run tests (PASS), commit `feat: heartbeat service (pulse + derived online status) with tests`.

---

## Task 11: Reputation placeholder service (TDD)

**Objective:** Expose reputation as a placeholder (no computation yet), satisfying the spec's "reputation placeholders" requirement.

**Files:**
- Create: `packages/server/src/service/reputationService.ts`, `packages/server/src/tests/reputationService.test.ts`

**Step 1: Test**

```ts
import { describe, it, expect } from "vitest";
import { MemoryStore } from "../store/memoryStore.js";
import { AgentService } from "../service/agentService.js";
import { ReputationService } from "../service/reputationService.js";

describe("ReputationService", () => {
  it("returns the placeholder reputation seeded at claim", () => {
    const store = new MemoryStore();
    const agent = new AgentService(store).claim({ name: "S", walletAddress: "0x" });
    const rep = new ReputationService(store).get(agent.id);
    expect(rep).toEqual({ score: 0, completedDeals: 0, disputes: 0 });
  });
});
```

**Step 3: Impl**

```ts
import type { Repository } from "../store/repository.js";
import type { ID, Reputation } from "../domain/types.js";

// Placeholder: real scoring arrives in MVP4. Today we surface stored counters.
export class ReputationService {
  constructor(private repo: Repository) {}
  get(id: ID): Reputation {
    const a = this.repo.getAgent(id);
    if (!a) throw new Error(`Agent ${id} not found`);
    return a.reputation;
  }
}
```

**Step 4/5:** Run tests (PASS), commit `feat: reputation placeholder service with tests`.

---

## Task 12: Fastify app + routes

**Objective:** Wire services into REST endpoints, register CORS, and export `buildApp` for tests.

**Files:**
- Create: `packages/server/src/app.ts`, `packages/server/src/routes/agents.ts`, `routes/markets.ts`, `routes/intents.ts`, `routes/offers.ts`, `routes/heartbeat.ts`

**Step 1: Write `app.ts`**

```ts
import Fastify from "fastify";
import cors from "@fastify/cors";
import { MemoryStore } from "./store/memoryStore.js";
import { seed } from "./store/seed.js";
import { registerAgentRoutes } from "./routes/agents.js";
import { registerMarketRoutes } from "./routes/markets.js";
import { registerIntentRoutes } from "./routes/intents.js";
import { registerOfferRoutes } from "./routes/offers.js";
import { registerHeartbeatRoutes } from "./routes/heartbeat.js";

export function buildApp() {
  const app = Fastify({ logger: false });
  app.register(cors, { origin: true });

  const store = new MemoryStore();
  seed(store); // fresh seed each process start (in-memory)

  app.get("/health", async () => ({ ok: true }));
  registerAgentRoutes(app, store);
  registerMarketRoutes(app, store);
  registerIntentRoutes(app, store);
  registerOfferRoutes(app, store);
  registerHeartbeatRoutes(app, store);
  return app;
}
```

**Step 2: Write `routes/agents.ts`**

```ts
import type { FastifyInstance } from "fastify";
import type { MemoryStore } from "../store/memoryStore.js";
import { AgentService } from "../service/agentService.js";
import { ReputationService } from "../service/reputationService.js";

export function registerAgentRoutes(app: FastifyInstance, store: MemoryStore) {
  const agents = new AgentService(store);
  const rep = new ReputationService(store);

  app.post("/agents", async (req) => agents.claim(req.body as any));
  app.get("/agents", async () => agents.list());
  app.get<{ Params: { id: string } }>("/agents/:id", async (req) => agents.getProfile(req.params.id));
  app.get<{ Params: { id: string } }>("/agents/:id/reputation", async (req) => rep.get(req.params.id));
}
```

**Step 3: Write the remaining route files (same shape)**

`routes/markets.ts`:
```ts
import type { FastifyInstance } from "fastify";
import type { MemoryStore } from "../store/memoryStore.js";
import { MarketService } from "../service/marketService.js";
export function registerMarketRoutes(app: FastifyInstance, store: MemoryStore) {
  const svc = new MarketService(store);
  app.post("/markets", async (req) => svc.create(req.body as any));
  app.get("/markets", async () => svc.list());
}
```

`routes/intents.ts`:
```ts
import type { FastifyInstance } from "fastify";
import type { MemoryStore } from "../store/memoryStore.js";
import { IntentService } from "../service/intentService.js";
export function registerIntentRoutes(app: FastifyInstance, store: MemoryStore) {
  const svc = new IntentService(store);
  app.post("/intents", async (req) => svc.post(req.body as any));
  app.get<{ Querystring: { marketId?: string } }>("/intents", async (req) => svc.list({ marketId: req.query.marketId }));
}
```

`routes/offers.ts`:
```ts
import type { FastifyInstance } from "fastify";
import type { MemoryStore } from "../store/memoryStore.js";
import { OfferService } from "../service/offerService.js";
export function registerOfferRoutes(app: FastifyInstance, store: MemoryStore) {
  const svc = new OfferService(store);
  app.post("/offers", async (req) => svc.post(req.body as any));
  app.get<{ Querystring: { marketId?: string; status?: string; maxPrice?: string } }>(
    "/offers",
    async (req) =>
      svc.search({
        marketId: req.query.marketId,
        status: req.query.status as any,
        maxPrice: req.query.maxPrice ? Number(req.query.maxPrice) : undefined,
      })
  );
}
```

`routes/heartbeat.ts`:
```ts
import type { FastifyInstance } from "fastify";
import type { MemoryStore } from "../store/memoryStore.js";
import { HeartbeatService } from "../service/heartbeatService.js";
export function registerHeartbeatRoutes(app: FastifyInstance, store: MemoryStore) {
  const hb = new HeartbeatService(store);
  app.post<{ Params: { id: string } }>("/agents/:id/heartbeat", async (req) => hb.pulse(req.params.id));
  app.get<{ Params: { id: string } }>("/agents/:id/heartbeat", async (req) => hb.status(req.params.id));
}
```

**Step 4: Typecheck + commit**

Run: `npm -w packages/server run build`
Expected: compiles.
Commit `feat: fastify app + REST routes for agents/markets/intents/offers/heartbeat`.

---

## Task 13: Server entry + integration test

**Objective:** Boot the server on `PORT` and add an integration test that exercises the full REST surface.

**Files:**
- Create: `packages/server/src/index.ts`, `packages/server/src/tests/integration.test.ts`

**Step 1: Write `index.ts`**

```ts
import { buildApp } from "./app.js";

const port = Number(process.env.SERVER_PORT ?? 3001);

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = buildApp();
  app.listen({ port, host: "0.0.0.0" }).then(() =>
    console.log(`Finality server listening on :${port}`)
  );
}
```

**Step 2: Write integration test**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../app.js";
import type { FastifyInstance } from "fastify";

describe("integration: full MVP1 flow", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = buildApp(); await app.ready(); });
  afterAll(async () => { await app.close(); });

  it("seeds a market and lets a seller post an offer discoverable by price", async () => {
    const markets = await app.inject({ method: "GET", url: "/markets" });
    const gpu = markets.json()[0];
    expect(gpu.name).toBe("GPU Compute");

    const offer = await app.inject({
      method: "POST", url: "/offers",
      payload: { agentId: "s1", marketId: gpu.id, title: "H100", description: "d", pricePerUnit: 8, terms: "t" },
    });
    expect(offer.json().status).toBe("ACTIVE");

    const found = await app.inject({ method: "GET", url: `/offers?marketId=${gpu.id}&maxPrice=10` });
    expect(found.json().length).toBe(1);
  });

  it("claims an agent, pulses, and reports online", async () => {
    const claimed = await app.inject({ method: "POST", url: "/agents", payload: { name: "S", walletAddress: "0x" } });
    const id = claimed.json().id;
    expect(claimed.json().apiToken).toMatch(/^tok_/);

    await app.inject({ method: "POST", url: `/agents/${id}/heartbeat` });
    const status = await app.inject({ method: "GET", url: `/agents/${id}/heartbeat` });
    expect(status.json().isOnline).toBe(true);
  });
});
```

**Step 3: Run all server tests**

Run: `npm -w packages/server test`
Expected: PASS (all unit + integration).
Commit `feat: server entry + REST integration test`.

---

## Task 14: Frontend scaffold

**Objective:** Create the React + Vite app wired for TypeScript.

**Files:**
- Create: `packages/web/package.json`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `index.html`, `src/main.tsx`

**Step 1: `package.json`**

```json
{
  "name": "@finality/web",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.24.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "typescript": "^5.4.5",
    "vite": "^5.3.1"
  }
}
```

**Step 2: `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "Bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true
  },
  "include": ["src"]
}
```

**Step 3: `tsconfig.node.json`**

```json
{ "compilerOptions": { "composite": true, "module": "ESNext", "moduleResolution": "Bundler", "allowSyntheticDefaultImports": true }, "include": ["vite.config.ts"] }
```

**Step 4: `vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: { port: Number(process.env.WEB_PORT ?? 5173), proxy: { "/api": { target: "http://localhost:3001", rewrite: (p) => p.replace(/^\/api/, "") } } },
});
```

**Step 5: `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Finality Agent Network</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**Step 6: `src/main.tsx`**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import "./theme.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
```

**Step 7: Install**

Run from root: `npm install`
Expected: web deps added.
Commit `chore: scaffold React + Vite web app`.

---

## Task 15: Theme + API client

**Objective:** Reuse the artifact's dark-teal design language and centralize API calls.

**Files:**
- Create: `packages/web/src/theme.css`, `packages/web/src/api/client.ts`

**Step 1: `theme.css`** (carries the artifact's `--accent: #2dd4bf` palette)

```css
:root {
  --bg: #070d12; --ink: #e8f3f5; --muted: #9fb2bb; --line: #24414a;
  --panel: #0f1b22; --accent: #2dd4bf; --blue: #38bdf8; --amber: #fbbf24; --red: #fb7185;
  --radius: 8px;
}
* { box-sizing: border-box; }
body {
  margin: 0; font-family: Inter, ui-sans-serif, system-ui, sans-serif;
  background: var(--bg); color: var(--ink); line-height: 1.5;
}
a { color: var(--accent); text-decoration: none; }
nav { display: flex; gap: 14px; padding: 14px 20px; border-bottom: 1px solid var(--line); background: var(--panel); }
nav a { color: var(--muted); font-weight: 600; }
nav a.active { color: var(--accent); }
main { width: min(1100px, calc(100vw - 40px)); margin: 0 auto; padding: 24px 0 56px; }
h1 { font-size: 28px; } h2 { font-size: 20px; color: var(--blue); }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px; margin: 12px 0; }
.row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
input, textarea, button, select { font: inherit; border-radius: 6px; border: 1px solid var(--line); background: #0b151b; color: var(--ink); padding: 8px 10px; }
button { background: var(--accent); color: #061014; border: none; font-weight: 700; cursor: pointer; }
button.secondary { background: transparent; color: var(--accent); border: 1px solid var(--accent); }
.pill { font-size: 12px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--line); }
.online { color: var(--accent); } .offline { color: var(--red); }
.muted { color: var(--muted); }
```

**Step 2: `api/client.ts`**

```ts
const BASE = "/api";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  listAgents: () => req("/agents"),
  getAgent: (id: string) => req(`/agents/${id}`),
  claimAgent: (body: any) => req("/agents", { method: "POST", body: JSON.stringify(body) }),
  pulse: (id: string) => req(`/agents/${id}/heartbeat`, { method: "POST" }),
  heartbeatStatus: (id: string) => req(`/agents/${id}/heartbeat`),
  getReputation: (id: string) => req(`/agents/${id}/reputation`),

  listMarkets: () => req("/markets"),
  createMarket: (body: any) => req("/markets", { method: "POST", body: JSON.stringify(body) }),

  listIntents: (marketId?: string) => req(`/intents${marketId ? `?marketId=${marketId}` : ""}`),
  postIntent: (body: any) => req("/intents", { method: "POST", body: JSON.stringify(body) }),

  searchOffers: (q: Record<string, string | undefined>) =>
    req(`/offers?${new URLSearchParams(Object.entries(q).filter(([, v]) => v).map(([k, v]) => [k, v!]) as any)}`),
  postOffer: (body: any) => req("/offers", { method: "POST", body: JSON.stringify(body) }),
};
```

**Step 3: Commit** `feat: web theme (artifact palette) + API client`.

---

## Task 16: App shell + routing

**Objective:** Provide navigation across MVP1 pages.

**Files:**
- Create: `packages/web/src/App.tsx`

**Step 1: Write `App.tsx`**

```tsx
import { Routes, Route, NavLink } from "react-router-dom";
import { Markets } from "./pages/Markets";
import { Discover } from "./pages/Discover";
import { ClaimAgent } from "./pages/ClaimAgent";
import { PostIntent } from "./pages/PostIntent";
import { PostOffer } from "./pages/PostOffer";
import { AgentProfile } from "./pages/AgentProfile";

export function App() {
  return (
    <div>
      <nav>
        <NavLink to="/">Markets</NavLink>
        <NavLink to="/discover">Discover</NavLink>
        <NavLink to="/claim">Claim Agent</NavLink>
        <NavLink to="/intent">Post Intent</NavLink>
        <NavLink to="/offer">Post Offer</NavLink>
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<Markets />} />
          <Route path="/discover" element={<Discover />} />
          <Route path="/claim" element={<ClaimAgent />} />
          <Route path="/intent" element={<PostIntent />} />
          <Route path="/offer" element={<PostOffer />} />
          <Route path="/agents/:id" element={<AgentProfile />} />
        </Routes>
      </main>
    </div>
  );
}
```

**Step 2: Build check** (will fail until pages exist — create stubs or proceed to next tasks). Commit after pages exist in Task 17–21.

---

## Task 17: Claim Agent page

**Objective:** Let a human bind a wallet and create an agent (the spec's stage 1–2).

**Files:**
- Create: `packages/web/src/pages/ClaimAgent.tsx`

**Step 1: Write `ClaimAgent.tsx`**

```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";

export function ClaimAgent() {
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [wallet, setWallet] = useState("");
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      const agent = await api.claimAgent({ name, walletAddress: wallet });
      setResult(agent);
      setTimeout(() => nav(`/agents/${agent.id}`), 1200);
    } catch (e: any) { setErr(e.message); }
  }

  return (
    <div>
      <h1>Claim an Agent</h1>
      <p className="muted">Bind a wallet and the network assigns a public key + API token + policy.</p>
      <form className="card" onSubmit={submit}>
        <div className="row">
          <label>Name <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="ResearchBot" /></label>
          <label>Wallet <input value={wallet} onChange={(e) => setWallet(e.target.value)} required placeholder="0x..." /></label>
        </div>
        <button type="submit">Claim</button>
        {err && <p className="offline">{err}</p>}
      </form>
      {result && (
        <div className="card">
          <p>Claimed! API token: <code>{result.apiToken}</code></p>
          <p className="muted">Redirecting to profile…</p>
        </div>
      )}
    </div>
  );
}
```

**Step 2: Commit** `feat: Claim Agent page`.

---

## Task 18: Markets list page

**Objective:** Show markets (the spec's "markets" primitive) and link into discovery.

**Files:**
- Create: `packages/web/src/pages/Markets.tsx`

**Step 1: Write `Markets.tsx`**

```tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";

export function Markets() {
  const [markets, setMarkets] = useState<any[]>([]);
  useEffect(() => { api.listMarkets().then(setMarkets).catch(() => setMarkets([])); }, []);
  return (
    <div>
      <h1>Markets</h1>
      {markets.map((m) => (
        <div className="card" key={m.id}>
          <h2>{m.name}</h2>
          <p className="muted">{m.description}</p>
          <div className="row">{m.tags.map((t: string) => <span className="pill" key={t}>{t}</span>)}</div>
          <Link to={`/discover?marketId=${m.id}`}><button className="secondary">Discover offers</button></Link>
        </div>
      ))}
    </div>
  );
}
```

**Step 2: Commit** `feat: Markets list page`.

---

## Task 19: Discover / search page

**Objective:** Buyer-side discovery by market, status, and max price (the spec's stage 4).

**Files:**
- Create: `packages/web/src/pages/Discover.tsx`

**Step 1: Write `Discover.tsx`**

```tsx
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";

export function Discover() {
  const [params, setParams] = useSearchParams();
  const [offers, setOffers] = useState<any[]>([]);
  const [maxPrice, setMaxPrice] = useState("");
  const marketId = params.get("marketId") ?? undefined;

  async function search() {
    const q: Record<string, string | undefined> = { marketId, status: "ACTIVE", maxPrice: maxPrice || undefined };
    const res = await api.searchOffers(q);
    setOffers(res);
  }
  useEffect(() => { search(); /* eslint-disable-next-line */ }, [marketId]);

  return (
    <div>
      <h1>Discover Offers</h1>
      <div className="card row">
        <label>Max price (USDC) <input value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} placeholder="10" /></label>
        <button onClick={search}>Search</button>
      </div>
      {offers.map((o) => (
        <div className="card" key={o.id}>
          <h2>{o.title}</h2>
          <p className="muted">{o.description}</p>
          <p>{o.pricePerUnit} USDC / {String(o.resourceSpec.unit ?? "unit")} · <span className="pill">{o.status}</span></p>
        </div>
      ))}
      {offers.length === 0 && <p className="muted">No offers match.</p>}
    </div>
  );
}
```

**Step 2: Commit** `feat: Discover (search offers) page`.

---

## Task 20: Post Intent page

**Objective:** Buyer publishes an intent (needs, max price, requirements) — spec stage 4 input.

**Files:**
- Create: `packages/web/src/pages/PostIntent.tsx`

**Step 1: Write `PostIntent.tsx`**

```tsx
import { useState } from "react";
import { api } from "../api/client";

export function PostIntent() {
  const [agentId, setAgentId] = useState("");
  const [marketId, setMarketId] = useState("");
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [markets, setMarkets] = useState<any[]>([]);
  const [msg, setMsg] = useState("");

  useState(() => { api.listMarkets().then(setMarkets).catch(() => {}); });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.postIntent({
        agentId, marketId, title, description: desc,
        requirements: { note: "see description" }, maxPrice: Number(maxPrice),
      });
      setMsg("Intent posted.");
    } catch (e: any) { setMsg(e.message); }
  }

  return (
    <div>
      <h1>Post an Intent (Buyer)</h1>
      <form className="card" onSubmit={submit}>
        <div className="row">
          <label>Your Agent ID <input value={agentId} onChange={(e) => setAgentId(e.target.value)} required /></label>
          <label>Market
            <select value={marketId} onChange={(e) => setMarketId(e.target.value)} required>
              <option value="">select…</option>
              {markets.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
        </div>
        <div className="row">
          <label>Title <input value={title} onChange={(e) => setTitle(e.target.value)} required /></label>
          <label>Max price (USDC) <input value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} required /></label>
        </div>
        <label>Description <textarea value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
        <button type="submit">Publish Intent</button>
        {msg && <p>{msg}</p>}
      </form>
    </div>
  );
}
```

**Step 2: Commit** `feat: Post Intent page`.

---

## Task 21: Post Offer page

**Objective:** Seller publishes an ACTIVE offer (spec stage 3) and can pulse.

**Files:**
- Create: `packages/web/src/pages/PostOffer.tsx`

**Step 1: Write `PostOffer.tsx`**

```tsx
import { useState } from "react";
import { api } from "../api/client";

export function PostOffer() {
  const [agentId, setAgentId] = useState("");
  const [marketId, setMarketId] = useState("");
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [price, setPrice] = useState("");
  const [terms, setTerms] = useState("");
  const [markets, setMarkets] = useState<any[]>([]);
  const [msg, setMsg] = useState("");

  useState(() => { api.listMarkets().then(setMarkets).catch(() => {}); });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const offer = await api.postOffer({
        agentId, marketId, title, description: desc,
        resourceSpec: { unit: "hour" }, pricePerUnit: Number(price), terms,
      });
      setMsg(`Offer ${offer.id} live. Pulse to prove liveness.`);
    } catch (e: any) { setMsg(e.message); }
  }

  return (
    <div>
      <h1>Post an Offer (Seller)</h1>
      <form className="card" onSubmit={submit}>
        <div className="row">
          <label>Your Agent ID <input value={agentId} onChange={(e) => setAgentId(e.target.value)} required /></label>
          <label>Market
            <select value={marketId} onChange={(e) => setMarketId(e.target.value)} required>
              <option value="">select…</option>
              {markets.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
        </div>
        <div className="row">
          <label>Title <input value={title} onChange={(e) => setTitle(e.target.value)} required /></label>
          <label>Price / unit (USDC) <input value={price} onChange={(e) => setPrice(e.target.value)} required /></label>
        </div>
        <label>Terms <input value={terms} onChange={(e) => setTerms(e.target.value)} /></label>
        <label>Description <textarea value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
        <button type="submit">Publish Offer</button>
        {msg && <p>{msg}</p>}
      </form>
    </div>
  );
}
```

**Step 2: Commit** `feat: Post Offer page`.

---

## Task 22: Agent Profile page (reputation placeholder + heartbeat)

**Objective:** Render an agent's profile: public key, policy, reputation placeholder, and live online status with a Pulse button.

**Files:**
- Create: `packages/web/src/pages/AgentProfile.tsx`

**Step 1: Write `AgentProfile.tsx`**

```tsx
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";

export function AgentProfile() {
  const { id } = useParams();
  const [agent, setAgent] = useState<any>(null);
  const [rep, setRep] = useState<any>(null);
  const [hb, setHb] = useState<any>(null);

  async function refresh() {
    if (!id) return;
    const [a, r, h] = await Promise.all([
      api.getAgent(id), api.getReputation(id), api.heartbeatStatus(id),
    ]);
    setAgent(a); setRep(r); setHb(h);
  }
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [id]);

  async function pulse() { if (!id) return; await api.pulse(id); refresh(); }

  if (!agent) return <p className="muted">Loading…</p>;
  return (
    <div>
      <h1>{agent.name}</h1>
      <div className="card">
        <p><span className="muted">Public key:</span> <code>{agent.publicKey}</code></p>
        <p><span className="muted">Wallet:</span> {agent.walletAddress}</p>
        <p><span className="muted">Vault:</span> {agent.policy.vaultBalance} USDC · <span className="muted">Max trade:</span> {agent.policy.maxSingleTrade} USDC</p>
      </div>
      <div className="card">
        <h2>Reputation (placeholder)</h2>
        <p>Score: <strong>{rep?.score}</strong> · Deals: {rep?.completedDeals} · Disputes: {rep?.disputes}</p>
        <p className="muted">Real scoring arrives in MVP4.</p>
      </div>
      <div className="card">
        <h2>Liveness</h2>
        <p className={hb?.isOnline ? "online" : "offline"}>
          {hb?.isOnline ? "● ONLINE" : "○ OFFLINE"} {hb?.lastSeen ? `· last seen ${new Date(hb.lastSeen).toLocaleTimeString()}` : ""}
        </p>
        <button onClick={pulse}>Pulse (heartbeat)</button>
      </div>
    </div>
  );
}
```

**Step 2: Commit** `feat: Agent Profile page (reputation placeholder + heartbeat)`.

---

## Task 23: README + run instructions

**Objective:** Document how to run MVP1 end-to-end.

**Files:**
- Create: `README.md`

**Step 1: Write `README.md`**

```md
# Finality Agent Network — MVP1: Agent Social Market

Foundation for the Finality Labs protocol: agents are claimed (wallet-bound),
post intents (buyers) and offers (sellers) into markets, discover each other by
price/market, pulse a heartbeat to prove liveness, and carry a placeholder
reputation. See `Finality Workflow Transformation Artifact.html` for the full vision.

## Stack
- `packages/server`: Node + TypeScript + Fastify (in-memory store, seeded with
  ResearchBot / GPUVendorAlpha). REST API on :3001.
- `packages/web`: React + Vite SPA on :5173, proxies `/api` -> :3001.

## Run
1. `npm install`
2. Terminal A: `npm run dev:server`   # http://localhost:3001
3. Terminal B: `npm run dev:web`      # http://localhost:5173
4. Open http://localhost:5173

## Test
`npm run test:server`   # vitest: unit + REST integration (all green)

## Out of scope (later MVPs)
Negotiation engine (MVP2), execution plans + escrow (MVP3), Solana HTLC / MPC /
ZK-TLS settlement + real reputation (MVP4), and the $50-vs-$500 safety transformer.
```

**Step 2: Commit** `docs: README with run + test instructions`.

---

## Task 24: End-to-end smoke verification

**Objective:** Prove the running system satisfies MVP1 from the user's perspective.

**Step 1: Start server**

Run (background): `npm run dev:server`
Verify: `curl http://localhost:3001/health` → `{"ok":true}`; `curl http://localhost:3001/markets` → includes "GPU Compute".

**Step 2: Start web**

Run (background): `npm run dev:web`
Open http://localhost:5173.

**Step 3: Manual flow**

1. Markets page shows "GPU Compute" with seeded offers.
2. Discover → set Max price 10 → the $8 H100 offer appears, the $30 one is filtered out.
3. Claim Agent → create "MyBot" with a wallet → redirected to profile; API token shown.
4. Agent Profile → click Pulse → status flips to ONLINE with timestamp.
5. Post Offer as a seller agent → re-check Discover → new offer appears.
6. Post Intent as a buyer agent → (lists via `/intents`; can extend UI later).

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: MVP1 smoke-verified (server + web)"
```

---

## Tests / Validation Summary

- **Backend unit tests** (Tasks 6–11): claim, market create/list, intent post/list, offer search-by-price, heartbeat online/offline, reputation placeholder — all via Vitest.
- **Backend integration test** (Task 13): boots `buildApp()`, seeds market, posts + discovers offer by price, claims agent + pulses + asserts online.
- **Frontend**: typechecks via `tsc -b`; manual smoke (Task 24) exercises every MVP1 feature.
- **Command:** `npm run test:server` → all green before marking done.

## Risks / Tradeoffs / Open Questions

- **In-memory store**: data resets on restart. Fine for MVP1; swap `MemoryStore` for a DB-backed `Repository` later without touching services.
- **No real auth**: `apiToken` is generated but not enforced on write routes. Add middleware in MVP2+.
- **"Semantic intent" search** is approximated by structured filters (market + maxPrice + status). True semantic match is a later enhancement.
- **Heartbeat cadence**: spec says 30s pulse; we derive online as <45s. UI Pulse button is manual for now; a `setInterval` auto-pulse can be added client-side.
- **Reputation** is a stored placeholder (score 0). Real computation deferred to MVP4.
- **Open question**: should intents also appear in the Discover UI feed? Plan ships offers in Discover; intents are POST-able and listable via API. Extend Discover to show intents alongside offers if desired.
