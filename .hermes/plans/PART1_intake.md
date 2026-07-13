# PART 1 — Intake + Identity + Matchmaker (HTTP)

> **Independent build session.** Edit ONLY `packages/intake/`. Read-only: `contracts/CONTRACT.md`, `contracts/schemas/*.json`.
> Depends on: Part 0 contract only. Does NOT need Part 2/3/4 to build or test.

## Goal
A Node + TypeScript + Fastify (or Express) HTTP service that:
1. Accepts buyer `intents` and seller `offers` (per contract §2/§3).
2. Verifies/registers the agent identity on **Base ERC-8004** (per contract §1). For MVP build, a LOCAL in-memory agent registry is acceptable as long as the ERC-8004 shape (`agentRegistry`, `agentId`, `wallet`) is preserved and a `registerOnChain()` seam exists (real call stubbed with a clearly marked TODO).
3. Runs a **Matchmaker**: when an intent and a compatible offer exist, create a negotiation room record and return `roomId` + `wssUrl` (the WS server is Part 2; here you only mint the `roomId` and store the pair — Part 2 reads it).
4. Exposes `GET /agents/:agentId/reputation` (returns a placeholder or real ERC-8004 `getSummary` if wired).

## Files to create (only these)
- `packages/intake/package.json` — name `@finality/intake`, type module, deps: fastify, @fastify/cors, zod, viem (for ERC-8004 read/ABI), vitest.
- `packages/intake/tsconfig.json`
- `packages/intake/src/index.ts` — bootstrap + listen on `PORT=3001`.
- `packages/intake/src/app.ts` — `buildApp()` (exported for tests) registering routes + cors.
- `packages/intake/src/store.ts` — in-memory: `intents[]`, `offers[]`, `rooms[]` (roomId→{buyerIntentId, sellerOfferId, status}). Seeded with ResearchBot intent + GPUVendorAlpha offer (from the artifact) so a match is demonstrable.
- `packages/intake/src/identity.ts` — `verifyOrRegister(agentRegistry, agentId, wallet)`: local check + `// TODO: real ERC-8004 IdentityRegistry.register on Base 0x8004…`. Returns ok.
- `packages/intake/src/matchmaker.ts` — `tryMatch(intent)` / `tryMatch(offer)` per contract §2 match rule; on match push a room `{roomId, status:'open'}`, return `{matched:true, roomId, wssUrl: process.env.WS_URL + '/negotiate/'+roomId}`.
- `packages/intake/src/routes.ts` — `POST /intents`, `POST /offers`, `GET /matches/:id`, `GET /agents/:agentId/reputation`, `GET /health`.
- `packages/intake/src/tests/*.test.ts` — see TDD below.

## TDD (must be green before done)
1. `POST /intents` valid body → `201 {intentId}`; invalid (missing wallet) → `400`.
2. `POST /offers` valid → `201 {offerId}`.
3. Seed intent(5h@max20) + offer(18/hr, H100) → `GET /matches/<intentId>` → `{matched:true, roomId, wssUrl}`; and `GET /matches/<offerId>` same roomId.
4. Mismatched (offer unitPrice 25 > max20) → `GET /matches` → `{matched:false}`.
5. Identity `verifyOrRegister` returns ok for a new agent; `registerOnChain` TODO present.

## Contract conformance (non-negotiable)
- Endpoints + bodies EXACTLY per `contracts/CONTRACT.md` §3.
- Intent/Offer fields validated with zod against `contracts/schemas/intent.json`,`offer.json` semantics.
- `roomId` format: `room_<random>`. `wssUrl` template from env `WS_URL` (default `ws://localhost:3002`).

## Out of scope (other parts)
- No WebSocket server (Part 2). No on-chain settlement (Part 3). No skill doc (Part 4).

## Done when
`npm -w packages/intake test` is green AND `npm -w packages/intake run dev` serves `/health` + a demonstrable match. Commit only inside `packages/intake/`.
