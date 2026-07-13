# Finality — Shared Contract (Part 0)

> **This file is the TRUNK.** Parts 1–4 (intake, negotiate, chain, skill) READ this
> and MUST NOT redefine these shapes. Only this file defines them. Edit here, not in part code.
> Every independent session building a part MUST conform to this contract.

---

## 1. Identity model
- An agent is identified cross-system by its **ERC-8004 identity**:
  - `agentRegistry`: `"eip155:8453:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"` (Base mainnet) or
    `"eip155:84532:0x8004A818BFB912233c491871b3d84c89A494BD9e"` (Base Sepolia).
  - `agentId`: `string` (the ERC-721 tokenId, decimal string).
- An agent also has a `wallet` (EVM address, where it receives/pays).
- The agent brings the SAME identity it has with its host (Hermes/OpenClaw/Claude). Finality
  verifies/registers it on ERC-8004.

## 2. Resource / offer / intent
All amounts are in **USDC**, unit price per hour unless `unit` says otherwise.

### Intent (buyer) — `schemas/intent.json`
```json
{
  "resource": "gpu",
  "qty": 5,
  "unit": "hour",
  "maxUnitPrice": 20,
  "requirements": { "cuda": "12.1", "gpu": "H100" },
  "agentRegistry": "eip155:84532:0x8004A818BFB912233c491871b3d84c89A494BD9e",
  "agentId": "1",
  "wallet": "0xBUYER"
}
```

### Offer (seller) — `schemas/offer.json`
```json
{
  "resource": "gpu",
  "unit": "hour",
  "unitPrice": 18,
  "terms": "per-hour billing, cancel anytime",
  "requirements": { "cuda": "12.1", "gpu": "H100" },
  "agentRegistry": "eip155:84532:0x8004A818BFB912233c491871b3d84c89A494BD9e",
  "agentId": "2",
  "wallet": "0xSELLER"
}
```

### Match rule (informative; implemented in Part 1)
`resource` equal, `unit` equal, offer `unitPrice` <= intent `maxUnitPrice`, and `requirements`
compatible (subset match). On match → create negotiation room, return `roomId` + `wssUrl`.

## 3. HTTP API (implemented in Part 1)
- `POST /intents`  body: Intent → `201 { intentId }`
- `POST /offers`  body: Offer  → `201 { offerId }`
- `GET  /matches/:id` → `200 { matched: bool, roomId?, wssUrl? }`
  - `id` may be an intentId or offerId. When matched, returns `roomId` + `wssUrl`.
- `GET  /agents/:agentId/reputation` → ERC-8004 `getSummary` (count, summaryValue, decimals)
- `GET  /health` → `{ ok: true }`

All write calls carry identity in the body (`agentRegistry`, `agentId`, `wallet`). The server
verifies the agent exists on ERC-8004 (registers if missing in its local view).

## 4. WebSocket negotiation protocol (implemented in Part 2)
- Connect: `wss://<host>/negotiate/:roomId`
- Two parties only: buyer + seller. Server enforces.
- Message envelope (JSON):
```json
{ "type": "counteroffer" | "accept" | "reject" | "close" | "system",
  "from": "buyer" | "seller",
  "round": 1,
  "payload": { ... },
  "ts": 1718000000000 }
```
- `counteroffer` payload: `{ unitPrice, qty, terms, requirements }`
- Server-enforced constraints (the policy):
  - `maxRounds` (default 10)
  - `minDelta` (default 0.01) — successive counteroffers must move price by >= minDelta or be rejected
  - price bounds from each party's policy (buyer maxUnitPrice, seller floor)
  - `turn` alternates buyer/seller; server rejects out-of-turn.
- On `accept` from one side → server echoes `system: deal-closed` with the agreed terms.
- On `close` or `maxRounds` reached → server emits `system: constraint-hit` with last terms.
- Server appends every message to a transcript; on terminal event → `transcriptHash = keccak256(json(transcript))`.
- Server then calls internal `POST /deals` (Part 3 hook) with:
```json
{ "roomId": "...", "transcriptHash": "0x...",
  "deal": { "buyer": {...}, "seller": {...}, "unitPrice": 18, "qty": 5, "terms": "..." } }
```

## 5. Execution plan / deal (consumed by Part 3)
```json
{
  "roomId": "room_abc",
  "transcriptHash": "0x...",
  "buyer":  { "agentRegistry": "...", "agentId": "1", "wallet": "0xBUYER" },
  "seller": { "agentRegistry": "...", "agentId": "2", "wallet": "0xSELLER" },
  "unitPrice": 18, "qty": 5, "terms": "...",
  "totalUsdc": 90
}
```

## 6. On-chain targets (Part 3)
- **ERC-8004 Reputation** (Base): `giveFeedback(agentId, value, decimals, tag1, tag2, endpoint, feedbackURI, feedbackHash)`; read `getSummary(agentId, [clientAddresses], tag1, tag2)`.
- **x402**: payer side creates payment, submits EIP-712 signature; merchant verifies/settles (mock facilitator in MVP3, real Base USDC EIP-3009 in MVP4).
- **Safety Transformer**: every payment gated server-side by policy (max single trade, anomaly multiplier). Part 3 exposes `evaluate(amount, policy) -> {allow, reason}`.

## 7. Folder ownership (NO overlaps → safe parallel builds)
- `packages/intake/`        → Part 1 (HTTP intake + identity + matchmaker)
- `packages/negotiate/`     → Part 2 (WebSocket venue)
- `packages/chain/`         → Part 3 (x402 + ERC-8004 + mock facilitator + evaluate)
- `packages/skill/`         → Part 4a (the publishable neutral skill doc + schemas copy)
- `packages/reference-agent/` → Part 4b (TS client loading the skill, calling Part1+Part2)
- `contracts/`             → THIS file + `schemas/*.json` (Part 0, written once)

> Rule: each part edits ONLY its own `packages/<name>/` folder + its own `package.json`.
> No part edits `contracts/` (read-only) or another part's folder.
