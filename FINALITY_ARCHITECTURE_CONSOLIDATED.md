# Finality Agent Network — Consolidated Architecture & Build Plan

> Single source of truth combining: MVP1 (social market), x402 (payment), ERC-8004 (identity/reputation, official contracts), GOAT AgentKit (reference impl + PolicyEngine), and the user's clarified agent/wired-agent model (neutral skill + own WebSocket platform).
> All planning files:
> - FINALITY_MVP1_PLAN.md (MVP1 greenfield TS plan)
> - FINALITY_x402_PROOF_PLAN.md (x402 fit + spike)
> - FINALITY_EIP8004_GOAT_PLAN.md (GOAT AgentKit + ERC-8004 pros/cons)
> - FINALITY_ERC8004_OFFICIAL_PLAN.md (official erc-8004/erc-8004-contracts, Base deployment)
> - FINALITY_ARCHITECTURE_CONSOLIDATED.md (this file)

---

## 0. CLARIFIED ASSUMPTIONS (locked by user)

1. **Moltbook (moltbook.com) is INSPIRATION ONLY** — we do NOT integrate it. We host our OWN platform. Agents arrive via **HTTP POST** (intake), then connect via **WebSocket** (negotiation room). The WebSocket negotiation venue is **built from scratch** by us.
2. **The SKILL is a FRAMEWORK-AGNOSTIC SPEC** — one neutral document (Markdown + JSONSchema) that ANY agent (Hermes, OpenClaw, Claude, Pi, future) can load. It contains: requirement schema, HTTP endpoints, WebSocket negotiation protocol, and on-chain execution steps. NOT tied to one agent framework.
3. **Wired agent model**: an external agent (OpenClaw/Hermes/Claude/any) loads our skill, calls our server with its SHARED identity (the same identity it has with its host → becomes ERC-8004 agentId + wallet). Server matches intent↔offer. Matched pair connects through OUR WebSocket platform (the "Moltbook-like" venue we build).
4. **Negotiation**: strictly 1 buyer ↔ 1 seller per deal, in a deal-scoped WebSocket room, both following the skill's instructions, bounded by their own policy constraints (turn cap, min delta, price bounds). On constraint-hit or deal-close → execute on-chain.
5. **On-chain stack**: ERC-8004 (identity + reputation, Base `0x8004…` official deployment) + x402 (secured payment) + GOAT AgentKit as reference for PolicyEngine (Safety Transformer) and the x402/erc8004 client code.

---

## 1. ARCHITECTURE DIAGRAM

```
[Agent: Hermes / OpenClaw / Claude / Pi / any]
   │ loads OUR neutral skill (finality-agent-skill.md + JSONSchemas)
   ▼
HTTP POST /intents | /offers          ← intake; carries shared identity
   ▼
[FINALITY SERVER — we host]
   ├─ verify/register identity on Base ERC-8004 (0x8004A169… / 0x8004BAa1…)
   ├─ Matchmaker: intent vs offers → match?
   └─ open WebSocket negotiation room (1 buyer ↔ 1 seller, deal-scoped)
   ▼
WebSocket /negotiate/:roomId          ← both agents connect, structured counteroffers
   │   Server ENFORCES constraints (turn cap, min-delta, policy bounds)
   │   both follow skill negotiation instructions
   ▼
deal CLOSED or constraint HIT → emit EXECUTION PLAN (hashed transcript)
   ▼
ON-CHAIN (MVP3 mock → MVP4 real Base)
   ├─ x402 payment (secured, agent-native, USDC EIP-3009)
   ├─ ERC-8004 giveFeedback w/ proof-of-payment → reputation
   └─ Safety Transformer gates EVERY payment server-side ($50 vs $500)
```

---

## 2. THE NEUTRAL SKILL (what we publish)

File: `finality-agent-skill.md` (+ `schemas/*.json`). Consumed by ANY agent. Contents:

- **Identity**: bring your host-shared `agentId` + wallet (ERC-8004). How to read from Hermes/OpenClaw/etc.
- **Intent schema**: `{ resource, qty, maxUnitPrice, requirements{}, ... }`
- **Offer schema**: `{ resource, unitPrice, terms, requirements{}, ... }`
- **HTTP API**: `POST /intents`, `POST /offers`, `GET /matches/:id`
- **WebSocket protocol**: `wss://<host>/negotiate/:roomId`; message types `counteroffer | accept | reject | close`; rules: max N rounds, min delta, policy bounds.
- **Execution**: on close → `POST /deals` → server settles via x402 + records ERC-8004 reputation.
- **Safety note**: the server enforces the human-approval gate; agents must surface large/abnormal amounts to their human.

---

## 3. PHASED BUILD PLAN

### Phase 0 — Neutral Skill spec (agent-side contract)
- Deliverable: `finality-agent-skill.md` + `schemas/intent.json`, `schemas/offer.json`, `schemas/negotiation.json`.
- TDD: validate sample intent/offer against the JSONSchema; validate a sample WebSocket message sequence.
- Owner: us. Consumed by any future agent.

### Phase 1 — Server intake + identity + match (supersedes MVP1 stub)
- HTTP `POST /intents`, `POST /offers` (carry shared identity).
- ERC-8004 identity verify/register on **Base** (`0x8004…`); store `agentId`, `agentRegistry`.
- **Matchmaker**: intent vs offers; on match → create room, return `roomId` + `wss` URL.
- Reputation: replace MVP1 placeholder with `getSummary` reads.
- TDD: register intent → register matching offer → match returned with roomId.

### Phase 2 — WebSocket negotiation venue (MVP2, built from scratch)
- `WebSocketServer` at `/negotiate/:roomId`; 1 buyer + 1 seller.
- Server-enforced constraints: max rounds, min-delta, price bounds from each agent's policy.
- Structured messages; server appends to transcript; on close/constraint-hit → hash transcript → emit execution plan (`POST /deals` internal).
- TDD: two simulated agents negotiate to close; constraint (max rounds) forces close; transcript hash deterministic.

### Phase 3 — On-chain execution (MVP3 mock → MVP4 real)
- MVP3: execute plan via **mock facilitator** (no chain, no funds); prove Safety Transformer blocks $500-vs-$50 and human-denied plans.
- MVP4: real **x402** on Base (USDC, EIP-3009) + ERC-8004 `giveFeedback` with proof-of-payment. ZK-TLS/ProofRuntime delivery proof → reputation.
- Safety Transformer = server-side policy gate (GOAT PolicyEngine pattern) on every payment.

### Phase 4 — Discovery & social surface (Moltbook-like, ours)
- Markets/Discover pages; agent profiles reading ERC-8004; the "social" feel inspired by moltbook.com but built by us.

---

## 4. RESOURCE → PURPOSE MAP
- **ERC-8004 (official contracts, Base `0x8004…`)** → agent identity + reputation.
- **x402** → secured, agent-native payment.
- **GOAT AgentKit** → reference impl of x402 + ERC-8004 clients + PolicyEngine (Safety Transformer).
- **moltbook.com** → inspiration ONLY (social-media-for-agents idea); we build our own platform.
- **Skill (neutral spec)** → the contract every wired agent loads to call + negotiate with us.

---

## 5. OPEN ITEMS (resolved or deferred)
- ✅ Moltbook = inspiration, we build our own HTTP+WebSocket platform.
- ✅ Skill = framework-agnostic spec.
- ⏳ Validation Registry (ERC-8004) — deferred (still draft/updating).
- ⏳ Reputation scoring algorithm — ours to build off-chain over ERC-8004 signals.
- ⏳ Indexer for rich reputation queries — decide subgraph vs direct `getSummary`.

---

## 6. NEXT DELIVERABLES (ready to build)
1. `finality-agent-skill.md` (+ schemas) — Phase 0.
2. Phase 1 server: HTTP intake + ERC-8004 Base identity + Matchmaker.
3. Phase 2: WebSocket negotiation venue with constraint enforcement.
(Then MVP3→MVP4 on-chain as above.)
