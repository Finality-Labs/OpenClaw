# PART 3 — On-chain Execution (x402 + ERC-8004 + Safety)

> **Independent build session.** Edit ONLY `packages/chain/`. Read-only: `contracts/CONTRACT.md`, `contracts/schemas/*.json`.
> Depends on: Part 0 contract (deal shape §5, on-chain targets §6). Does NOT need Part 1/2/4 to build or test (expose `POST /deals` locally).

## Goal
A Node + TypeScript service that, given a closed deal (contract §5), executes settlement + reputation:
1. Exposes `POST /deals` (port 3003) accepting the deal object from Part 2's `notifyDeal`.
2. **Safety Transformer**: `evaluate(totalUsdc, policy) -> {allow, reason}` where policy = `{vaultBalance, maxSingleTrade, dailyBudget, anomalyMultiplier}`. Blocks if `totalUsdc > maxSingleTrade`, or `> vaultBalance`, or `> 10x` a normal pattern (anomaly). This is the $50-vs-$500 guard.
3. **Payment via x402**: implement a `MockFacilitator` (in-memory `/verify`+`/settle`, records to a local ledger, returns fake txHash — NO chain, NO funds). For MVP3 this is the only path. Structure code so a real facilitator (Base USDC EIP-3009) can be swapped in MVP4 via a clearly marked `// TODO real x402` seam. Payer flow: build payment payload (EIP-712-style struct), "settle", record ledger entry `{payer, payee, amount, txHash}`.
4. **Reputation via ERC-8004**: after (mock) settlement, record feedback. Use `giveFeedback(agentId, value, decimals, tag1, tag2, endpoint, feedbackURI, feedbackHash)` shape. For MVP3, call a local stub `recordFeedback()` that stores `{agentId, value, tag1, proofOfPayment}` (proofOfPayment = the mock txHash). Expose `getReputation(agentId)` reading local store (mirrors `getSummary`). Real Base `0x8004BAa1…` call is a `// TODO` seam.
5. `GET /health` → `{ok:true}`.

## Files to create (only these)
- `packages/chain/package.json` — name `@finality/chain`, deps: fastify, @fastify/cors, zod, viem (keccak/EIP-712 types), vitest.
- `packages/chain/tsconfig.json`
- `packages/chain/src/index.ts` — listen on `PORT=3003`.
- `packages/chain/src/app.ts` — `buildApp()` (exported for tests).
- `packages/chain/src/safety.ts` — `evaluate(amount, policy)` per §6. Pure function, fully unit-tested.
- `packages/chain/src/mockFacilitator.ts` — in-memory verify/settle + ledger.
- `packages/chain/src/reputation.ts` — `recordFeedback()` + `getReputation()` local store (ERC-8004 `getSummary` shape: count, summaryValue, decimals). `// TODO real ERC-8004 ReputationRegistry on Base 0x8004BAa1…`.
- `packages/chain/src/deals.ts` — `POST /deals`: validate deal (§5), `evaluate` (block → 402/error), mock settle, record reputation w/ proofOfPayment, return `{ok, txHash, reputation}`.
- `packages/chain/src/tests/*.test.ts` — see TDD.

## TDD (must be green)
1. `safety.evaluate(500, {maxSingleTrade:50,...})` → `{allow:false, reason:"exceeds maxSingleTrade"}`; `evaluate(40,{...})` → allow. Anomaly: `evaluate(1000,{maxSingleTrade:500, anomalyMultiplier:10, normal:50})` → block.
2. `POST /deals` with a valid $90 deal (within policy) → 200, returns `txHash` + reputation entry; ledger has 1 entry.
3. `POST /deals` with $500 deal (over maxSingleTrade 50) → rejected (e.g. 402/422), NO ledger entry, NO reputation write.
4. `getReputation(agentId)` reflects a recorded feedback (count=1, summaryValue matches).
5. `GET /health` → ok.

## Contract conformance
- Deal input EXACTLY contract §5. Reputation read shape EXACTLY ERC-8004 `getSummary` (count, summaryValue, summaryValueDecimals).
- proofOfPayment in feedback file = `{fromAddress, toAddress, chainId, txHash}` (contract §6 / EIP-8004 feedback file shape).

## Out of scope
- No HTTP intake (Part 1). No WebSocket (Part 2). No skill doc (Part 4). Real mainnet x402/ERC-8004 = TODO seams only.

## Done when
`npm -w packages/chain test` green; `npm -w packages/chain run dev` serves `/health` + a `POST /deals` that settles (mock) + records reputation. Commit only `packages/chain/`.
