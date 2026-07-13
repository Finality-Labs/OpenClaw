# PART 2 — WebSocket Negotiation Venue (from scratch)

> **Independent build session.** Edit ONLY `packages/negotiate/`. Read-only: `contracts/CONTRACT.md`, `contracts/schemas/negotiation.json`.
> Depends on: Part 0 contract (message shapes, constraints). You may STUB the matchmaker: assume a room exists (`GET /internal/room/:roomId` returns the pair, or just accept any `roomId` and treat first buyer/seller connections as the pair). Part 1 provides real rooms later; your code must not require Part 1 to run (use an in-memory room registry keyed by roomId).

## Goal
A Node + TypeScript WebSocket server (`ws` library) at `/negotiate/:roomId` that:
1. Accepts exactly TWO parties: one `buyer`, one `seller`. Reject a 3rd connection to a room.
2. Enforces the negotiation protocol per contract §4:
   - `type` ∈ counteroffer|accept|reject|close|system
   - turns **alternate** buyer↔seller; out-of-turn message → server sends `system: error` and ignores.
   - `maxRounds` (default 10): after N alternating counteroffers with no accept, server emits `system: constraint-hit` with last terms and closes the room.
   - `minDelta` (default 0.01): a `counteroffer` whose price moved < minDelta from the last opposing offer (when within bounds) → rejected with `system: error` (prevents stalling). 
   - price bounds: buyer may never accept > its `maxUnitPrice`; seller may never go below its floor (passed in join payload or first offer). Enforce on `accept`.
3. Appends every accepted message to a `transcript` array.
4. On `accept` (by one side, valid) → server broadcasts `system: deal-closed` with agreed `{unitPrice, qty, terms}`. On `close`/`maxRounds` → `system: constraint-hit`.
5. On terminal event → compute `transcriptHash = keccak256(JSON.stringify(transcript))` (use `viem` `keccak256`/`stringToHex` or `ethers`/`js-sha3`). Then call internal `POST http://localhost:3003/deals` (Part 3 endpoint) with the deal object per contract §5. If Part 3 not running, log + continue (don't crash).

## Files to create (only these)
- `packages/negotiate/package.json` — name `@finality/negotiate`, deps: ws, viem (keccak), zod, vitest, @types/ws.
- `packages/negotiate/tsconfig.json`
- `packages/negotiate/src/index.ts` — start WS on `PORT=3002`, path `/negotiate/:roomId`.
- `packages/negotiate/src/room.ts` — Room class: members (buyer/seller sockets), transcript, rounds, status; enforces turn/round/delta/bounds; emits terminal events; computes hash.
- `packages/negotiate/src/protocol.ts` — parse/validate message per `schemas/negotiation.json`; constraint config (`maxRounds`,`minDelta`).
- `packages/negotiate/src/settle.ts` — `notifyDeal(deal)` → `POST localhost:3003/deals` (best-effort, catch errors).
- `packages/negotiate/src/tests/*.test.ts` — use `ws` + a fake server in-process (vitest) OR a mock socket pair. See TDD.

## TDD (must be green)
1. Two clients connect to same `roomId` as buyer/seller → third connection rejected.
2. Buyer counteroffer(20) → seller counteroffer(19) → buyer `accept`(19) → both receive `system: deal-closed` with unitPrice 19; transcriptHash present and deterministic (re-run same sequence → same hash).
3. Out-of-turn: seller sends immediately after seller (no buyer turn) → `system: error`, ignored.
4. `maxRounds=2`: buyer(20), seller(19), buyer(18), seller(17) → after 2 rounds no accept → `system: constraint-hit`.
5. `minDelta` violation → rejected with error.
6. On deal-close, `notifyDeal` called with contract §5 shape (use a local HTTP stub on 3003 returning 200).

## Contract conformance
- Message envelope EXACTLY per `contracts/CONTRACT.md` §4. `transcriptHash` via keccak256 of `JSON.stringify(transcript)`.
- Deal payload EXACTLY per contract §5 (`roomId`, `transcriptHash`, `buyer`, `seller`, `unitPrice`, `qty`, `terms`, `totalUsdc`).

## Out of scope
- No HTTP intake (Part 1). No chain settlement logic (Part 3) beyond the `POST /deals` notification.

## Done when
`npm -w packages/negotiate test` green; server starts and a manual two-client run produces `deal-closed` + a hash. Commit only `packages/negotiate/`.
