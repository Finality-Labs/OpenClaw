# FINALITY — WORKFLOW & SHARED LOG

> SHARED SOURCE OF TRUTH for multi-session builds. Any session can read/edit this file.
> RULES:
>  - Each session owns ONE part row. Only edit YOUR part's row + append to the LOG.
>  - Do NOT edit another session's row or another part's folder.
>  - Contract (the trunk everything must follow): `contracts/CONTRACT.md` + `contracts/schemas/*.json`
>  - Update your row's STATUS + LAST-UPDATE whenever you make progress.
>  - `npm install` already run at repo root (workspaces linked). To add deps, edit YOUR package.json then `npm install`.

---

## PART ASSIGNMENTS (edit your own row only)

| Part | Folder | What it builds | Owner session | Status | Last update | Spec file |
|------|--------|----------------|---------------|--------|-------------|-----------|
| 0 | `contracts/` | Shared contract + JSON schemas (TRUNK) | coordinator | DONE | 2026-07-12 | (this is the trunk) |
| 1 | `packages/intake/` | HTTP intake + ERC-8004 identity + Matchmaker | coordinator | DONE | 2026-07-12 | `.hermes/plans/PART1_intake.md` |
| 2 | `packages/negotiate/` | WebSocket negotiation venue (from scratch) | part2-session | DONE | 2026-07-12 | `.hermes/plans/PART2_negotiate.md` |
| 3 | `packages/chain/` | x402 + ERC-8004 + mock facilitator + Safety eval | part3-session | DONE | 2026-07-12 | `.hermes/plans/PART3_chain.md` |
| 4 | `packages/skill/` + `packages/reference-agent/` | Neutral agent skill + reference client | part4-session | DONE | 2026-07-12 | `.hermes/plans/PART4_skill.md` |

STATUS values: TODO → IN-PROGRESS → TESTS-GREEN → DONE

---

## WHAT EACH SESSION RECEIVES (handoff bundle)
Give each launched session these 3 things (everything else is in the repo):
1. `WORKFLOW.md` (rules + log — they log here).
2. `contracts/CONTRACT.md` + `contracts/schemas/*.json` (the trunk they MUST follow).
3. Their spec: `.hermes/plans/PART< N >_*.md`.

All packages are scaffolded (package.json + tsconfig.json present, deps declared).
Run `npm install` was done at root; if a session adds deps, they edit their own package.json + run `npm install`.

Ports: intake :3001 · negotiate :3002 (WS `/negotiate/:roomId`) · chain :3003 (`POST /deals`).
Env: `WS_URL` (negotiate base, default `ws://localhost:3002`), `DEALS_URL` (chain, default `http://localhost:3003`).

---

## SHARED LOG (append, newest at top)

### 2026-07-12 — Part 4 session (skill + reference-agent DONE)
- **Part 4 built and verified:** `npm -w packages/reference-agent test` → 12/12 green (11 unit + 1 real-server E2E); `tsc` build clean.
- `packages/skill/`: `finality-agent-skill.md` (the neutral, framework-agnostic skill: purpose, identity, intent/offer schemas, HTTP API, WS protocol incl. the `join` handshake the real venue requires, negotiation strategy, deal shape, execution, out-of-scope) + `README.md` (how to load into any agent).
- `packages/reference-agent/`: `src/negotiate.ts` (WS client + strategy, `join` handshake, minDelta/alternating-turn-safe moves, accept logic, safety surfacing of abnormal amounts), `src/index.ts` (CLI buyer|seller with ajv schema validation against `contracts/schemas`), `src/tests/negotiate.test.ts` (schema + convergence), `src/tests/e2e-negotiate.test.ts` (spins up the REAL `packages/negotiate` `startServer` and runs buyer+seller to a `deal-closed`). Added `ajv`/`ajv-formats` deps.
- **Key interop finding:** the real Part 2 server requires a `join` message with a *nested* `identity` (`{type:"join", role, identity:{agentRegistry, agentId, wallet, maxUnitPrice|floorUnitPrice}}`) before any counteroffer, and the buyer must wait for the `system: "room ready — buyer to move"` frame. This was NOT in the contract trunk (§4 only specifies the counteroffer/accept envelope) — documented in the skill so future clients are correct.
- Reference client points at `FINALITY_HTTP`/`FINALITY_WS` or `--server`/`--ws`; settlement is Part 3's job (E2E logs expected `Part 3 unreachable` when chain not running).

### 2026-07-12 — Coordinator (MERGE COMPLETE — end product running)
- Created `packages/orchestrator/` (root workspace): `start-all.ts` boots all three services IN-PROCESS (intake:3001, negotiate:3002 WS, chain:3003), `run-e2e.ts` drives a full deal.
- **END-TO-END PASS:** buyer intent (2h H100 @ max $20) + seller offer (H100 @ $18) → intake MATCHED → room + wssUrl → both agents negotiate (Part 4 client + Part 2 venue) → deal-closed (price 20, qty 2, transcriptHash) → negotiate notifies chain → Safety eval (passed, $40 < $50 cap) → mock x402 settle → ERC-8004 reputation recorded for BOTH agents (count 1 each).
- Safey guard ALSO verified live earlier: a $100 deal (5h×$20) returned **422 blocked** by chain — the $50-vs-$500 Safety Transformer works in the merged system.
- Unit suites all green: intake 14, negotiate 9, chain 14, reference-agent 12 = **49 tests**.
- `npm install` re-run; orchestrator added to root workspaces.
- **The four parts are merged into one runnable Finality Agent Network.** Run with `npm -w packages/orchestrator run e2e` (or `run start` to keep all services up).

### 2026-07-12 — Coordinator (Part 1 DONE)
- **Part 1 (intake) built and verified.** 14/14 vitest tests pass; `tsc` build clean.
- Files: `src/types.ts`, `src/store.ts` (in-memory + `matches()` per contract §2), `src/identity.ts` (`verifyOrRegister` with ERC-8004 Base `0x8004…` TODO seam), `src/matchmaker.ts` (opens room, returns `roomId`+`wssUrl`), `src/routes.ts` (`POST /intents`, `POST /offers`, `GET /matches/:id`, `GET /agents/:agentId/reputation`, `POST /_identity`, `/health`), `src/app.ts` (`buildApp`), `src/index.ts`, `src/seed.ts` (ResearchBot intent + GPUVendorAlpha offer from the artifact).
- Tests: `src/tests/store.test.ts` (8) + `src/tests/api.test.ts` (6). Verified: match logic, identity seam, POST 201/400, seeded match returns roomId+wssUrl, mismatched returns matched:false.
- Note: wallet regex relaxed to `^0x[0-9a-zA-Z]+$` so placeholder wallets (0xBUYER) pass; real hex wallets still match.

### 2026-07-12 — Coordinator (prep complete, READY TO LAUNCH 4 SESSIONS)
- Wrote Part 3 spec → `.hermes/plans/PART3_chain.md` and Part 4 spec → `.hermes/plans/PART4_skill.md`. (Parts 1 & 2 specs written earlier.)
- Scaffolded ALL 5 packages with package.json + tsconfig.json (intake, negotiate, chain, skill, reference-agent). Deps declared: fastify, @fastify/cors, ws, zod, viem, vitest, tsx, typescript, @types/*.
- Ran `npm install` at repo root (workspaces linked). [background, see /tmp/npm_install.log]
- Folder ownership is non-overlapping → 4 sessions cannot collide on files.
- Decision recap (see FINALITY_ARCHITECTURE_CONSOLIDATED.md): external wired agent calls us; 1:1 buyer↔seller; Moltbook = inspiration only (we build own HTTP+WS); skill = framework-agnostic spec.
- Reference resources: x402 docs, EIP-8004 spec, GOATNetwork/agentkit, official erc-8004/erc-8004-contracts (Base 0x8004…).

### 2026-07-12 — Coordinator (Part 0 + specs)
- Root package.json (npm workspaces). Part 0 contract `contracts/CONTRACT.md` (identity/ERC-8004 Base, intent/offer, HTTP API, WS protocol, deal shape, on-chain targets, folder ownership).
- Schemas: intent.json, offer.json, negotiation.json.
- Parts 1 & 2 specs written.

---

## MERGE PLAN (run after all parts DONE)
1. `packages/intake` HTTP :3001 → returns roomId+wssUrl on match.
2. `packages/negotiate` WS :3002 `/negotiate/:roomId` → on deal-close POSTs :3003/deals.
3. `packages/chain` `POST :3003/deals` → Safety eval → mock (MVP3) x402 + ERC-8004 reputation.
4. `packages/skill` publishes finality-agent-skill.md; `packages/reference-agent` is demo client.
5. Thin root wiring (docker-compose or `server/index.ts`) connects intake+negotiate+chain via env URLs.
6. E2E: reference-agent posts intent → match → WS negotiate → deal → chain settle → reputation.

---

## OPEN QUESTIONS (cross-session)
- Validation Registry (ERC-8004) deferred (draft). Reputation scoring = ours (off-chain).
- Indexer for reputation: subgraph vs direct getSummary — undecided.
- Real mainnet x402/ERC-8004 = TODO seams in Parts 1 & 3 (MVP3 = mock; MVP4 = real Base).
