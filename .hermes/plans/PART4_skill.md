# PART 4 — Neutral Agent Skill + Reference Client

> **Independent build session.** Edit ONLY `packages/skill/` and `packages/reference-agent/`. Read-only: `contracts/CONTRACT.md`, `contracts/schemas/*.json`.
> Depends on: Part 0 contract. Does NOT need Part 1/2/3 running to build (reference client can point at env URLs and be tested against stubs/local servers).

## Goal
(a) **`packages/skill/`** — the publishable, FRAMEWORK-AGNOSTIC skill spec any agent (Hermes, OpenClaw, Claude, Pi, future) loads. It is documentation + schemas, not runtime code.
(b) **`packages/reference-agent/`** — a minimal TypeScript reference client that PROVES the skill works: loads the skill instructions, `POST`s an intent (Part 1), polls `GET /matches`, connects to the WS room (Part 2) as buyer, negotiates per the skill's rules, and on deal-close does nothing else (settlement is Part 3's job — but the client may optionally call a stub). This is the end-to-end demo from an agent's perspective.

## Files to create (only these)
- `packages/skill/package.json` — name `@finality/skill`, type module, deps: none (doc package) or zod for schema validation example.
- `packages/skill/finality-agent-skill.md` — THE skill. Must contain, in agent-readable prose:
  - **Purpose**: how to buy/sell resources (e.g. GPU) through Finality.
  - **Identity**: bring your host-shared `agentRegistry`+`agentId`+`wallet` (ERC-8004 Base). How to read from Hermes/OpenClaw/Claude generically.
  - **Intent schema** (reference `contracts/schemas/intent.json`): resource, qty, unit, maxUnitPrice, requirements, identity.
  - **Offer schema** (reference `contracts/schemas/offer.json`).
  - **HTTP API**: `POST /intents`, `POST /offers`, `GET /matches/:id` (returns roomId+wssUrl). Include example curl/JSON.
  - **WebSocket protocol**: connect `wss://<host>/negotiate/:roomId`; message envelope (contract §4); rules (alternating turns, maxRounds, minDelta, price bounds); how to send counteroffers and accept.
  - **Negotiation strategy instructions**: start at your max/min, move by >=minDelta, accept when within your bound, never exceed your policy (Safety Transformer is server-side too — but you must still surface abnormal amounts to your human).
  - **Execution**: on `system: deal-closed`, the platform handles settlement+reputation (x402+ERC-8004); agent need not pay directly. Note the deal object shape (contract §5).
- `packages/skill/README.md` — how a developer adds this skill to their agent (copy `finality-agent-skill.md` into their skill dir; any framework supported).
- `packages/reference-agent/package.json` — name `@finality/reference-agent`, deps: ws, zod, node-fetch (or built-in fetch), viem (keccak for any hashing).
- `packages/reference-agent/tsconfig.json`
- `packages/reference-agent/src/index.ts` — CLI: args `--role buyer|seller --resource gpu --qty 5 --price 20 --server http://localhost:3001 --ws ws://localhost:3002`. Loads skill instructions (imports the md? no — just follows hardcoded-from-skill logic; the md is the human/agent doc). Buyer: POST intent → poll match → WS connect as buyer → negotiate → on deal-closed print result. Seller: POST offer → poll match → WS connect as seller → negotiate.
- `packages/reference-agent/src/negotiate.ts` — WS client implementing the protocol per skill (alternating, minDelta, accept logic).
- `packages/reference-agent/src/tests/*.test.ts` — TDD: (1) schema validation of intent/offer against `contracts/schemas`; (2) a scripted two-client negotiation using a local mock WS or the real Part 2 server if available (guard with env; if Part2 not running, skip with a clear message — don't fail the build).

## TDD (must be green)
1. Intent/offer produced by the client validate against `contracts/schemas/intent.json`+`offer.json` (zod).
2. `negotiate.ts` unit: given buyer max 20, seller floor 15, starting 18 → converges to an accepted price within bounds; respects minDelta + alternating turns.
3. (Integration, optional/skippable) full flow against live Part1+Part2 if env set; else logged skip.

## Contract conformance
- Skill HTTP/WS described MUST match `contracts/CONTRACT.md` §3/§4 exactly.
- Client messages MUST use the envelope in `contracts/schemas/negotiation.json` + §4.

## Out of scope
- No server code (Parts 1/2/3). The skill is docs+schemas; the reference client is a thin demo. Real settlement is Part 3.

## Done when
`npm -w packages/reference-agent test` green (schema + negotiate logic); `finality-agent-skill.md` exists and matches the contract. Commit only `packages/skill/` + `packages/reference-agent/`.
