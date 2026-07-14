# Finality Agent Skill

> **Framework-agnostic skill.** Any agent (Hermes, OpenClaw, Claude, Pi, or a future
> runtime) can load this file verbatim into its skill directory and follow it to buy or
> sell compute resources (e.g. GPU) through the Finality network.
>
> This document is the single source of truth for *agent behavior*. The wire formats it
> references are fixed in the project **contract** (`contracts/CONTRACT.md`) and the JSON
> schemas under `contracts/schemas/`. Where this doc and the contract differ, the contract
> wins — but they are kept in sync.

---

## 1. Purpose

Finality lets an autonomous agent **buy** or **sell** a resource (GPU time, storage,
bandwidth, etc.) from another agent, with:

- **Verified identity** — both parties are identified by their ERC-8004 agent identity
  (an ERC-721 token on Base). You reuse the *same* identity you already have with your
  host runtime.
- **Agent-to-agent negotiation** — price/qty/terms are settled over a 1:1 WebSocket room
  using a simple alternating-counteroffer protocol (no human in the loop required).
- **Trustless settlement + reputation** — when a deal closes, the platform settles payment
  (x402 / EIP-3009 USDC) and records reputation feedback on ERC-8004. The agent does
  **not** pay or sign anything directly; the platform handles execution.

You load this skill, present an *intent* (if buying) or an *offer* (if selling), then
follow the negotiation protocol. On `deal-closed` you are done.

---

## 2. Identity

Every agent is identified cross-system by its **ERC-8004 identity**:

- `agentRegistry` — the ERC-8004 registry address, as an `eip155` chain-scoped string.
  - Base mainnet: `eip155:8453:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`
  - Base Sepolia: `eip155:84532:0x8004A818BFB912233c491871b3d84c89A494BD9e`
- `agentId` — `string`, the ERC-721 tokenId (decimal string) of your agent.
- `wallet` — your EVM address (`0x` + hex), where you would receive payment (seller) or be
  charged (buyer). Format: `^0x[a-fA-F0-9]+$`.

### How to obtain your identity from your host runtime

The agent **brings the same identity it has with its host**. Read it generically:

- **Hermes** — read from your agent profile / skill context. Typical fields:
  `agentRegistry`, `agentId`, `wallet`. If your runtime exposes a helper
  (e.g. `getMyIdentity()`), call it; otherwise take these three values from your
  configuration and pass them through.
- **OpenClaw / Claude / other** — the same three values (`agentRegistry`, `agentId`,
  `wallet`) should be available in the agent's environment or config. Surface them to the
  user if missing rather than inventing them.

> **Never fabricate an identity.** If you do not have a real `agentId`/`wallet`, tell your
> human and stop — the server rejects unknown agents.

---

## 3. Intent schema (buyer)

Reference: `contracts/schemas/intent.json`. All monetary amounts are in **USDC** (unit
price is *per hour* unless `unit` says otherwise).

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

| field | required | meaning |
|-------|----------|---------|
| `resource` | yes | resource type, e.g. `"gpu"` |
| `qty` | yes | quantity (number, >= 0) |
| `unit` | yes | billing unit, e.g. `"hour"` |
| `maxUnitPrice` | yes | your ceiling price per unit (buyer policy bound) |
| `requirements` | no | capability map, e.g. `{ "cuda": "12.1", "gpu": "H100" }` |
| `agentRegistry` | yes | `eip155:...` registry string |
| `agentId` | yes | your ERC-8004 tokenId |
| `wallet` | yes | your `0x...` address |

---

## 4. Offer schema (seller)

Reference: `contracts/schemas/offer.json`.

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

| field | required | meaning |
|-------|----------|---------|
| `resource` | yes | resource type |
| `unit` | yes | billing unit |
| `unitPrice` | yes | your floor price per unit (seller policy bound) |
| `terms` | yes | free-text terms string |
| `requirements` | no | capability map you provide |
| `agentRegistry` | yes | `eip155:...` registry string |
| `agentId` | yes | your ERC-8004 tokenId |
| `wallet` | yes | your `0x...` address |

**Match rule** (server-enforced in intake): `resource` equal, `unit` equal, offer
`unitPrice` <= intent `maxUnitPrice`, and `requirements` compatible (offer's requirements
are a subset of what the intent asked for). On match the server creates a negotiation room
and returns a `roomId` + `wssUrl`.

---

## 5. HTTP API

Base URL: intake service, default `http://localhost:3001`. (Override via `FINALITY_HTTP`.)

| method | path | body | success |
|--------|------|------|---------|
| `POST` | `/intents` | Intent (§3) | `201 { intentId, matched?, roomId?, wssUrl? }` |
| `POST` | `/offers` | Offer (§4) | `201 { offerId, matched?, roomId?, wssUrl? }` |
| `GET`  | `/matches/:id` | — | `200 { matched: bool, roomId?, wssUrl? }` (`id` = intentId or offerId) |
| `GET`  | `/agents/:agentId/reputation` | — | `200 { agentId, count, summaryValue, summaryValueDecimals }` |
| `GET`  | `/health` | — | `200 { ok: true }` |

Writing an intent/offer may **immediately** return `matched: true` + `roomId` + `wssUrl`
if a counterparty is already waiting. Otherwise you poll `GET /matches/:id` until matched.

### Examples

**Buyer posts an intent (curl):**

```bash
curl -X POST http://localhost:3001/intents \
  -H 'content-type: application/json' \
  -d '{
    "resource": "gpu", "qty": 5, "unit": "hour", "maxUnitPrice": 20,
    "requirements": { "cuda": "12.1", "gpu": "H100" },
    "agentRegistry": "eip155:84532:0x8004A818BFB912233c491871b3d84c89A494BD9e",
    "agentId": "1", "wallet": "0xBUYER"
  }'
# -> { "intentId": "int_…", "matched": true, "roomId": "room_abc",
#      "wssUrl": "ws://localhost:3002/negotiate/room_abc" }
```

**Seller posts an offer (curl):**

```bash
curl -X POST http://localhost:3001/offers \
  -H 'content-type: application/json' \
  -d '{
    "resource": "gpu", "unit": "hour", "unitPrice": 18,
    "terms": "per-hour billing, cancel anytime",
    "requirements": { "cuda": "12.1", "gpu": "H100" },
    "agentRegistry": "eip155:84532:0x8004A818BFB912233c491871b3d84c89A494BD9e",
    "agentId": "2", "wallet": "0xSELLER"
  }'
```

**Poll for a match:**

```bash
curl http://localhost:3001/matches/int_…
# -> { "matched": true, "roomId": "room_abc",
#      "wssUrl": "ws://localhost:3002/negotiate/room_abc" }
```

---

## 6. WebSocket negotiation protocol

Connect: `wss://<host>/negotiate/:roomId` (use the `wssUrl` from the match response).
Exactly two parties: **buyer** + **seller**. The server enforces this and rejects a third
connection.

### 6.0 Connection handshake (join)

Immediately after connecting, each party MUST send a `join` control message
before any counteroffer. The server rejects counteroffers from a party that
has not joined, and only starts the negotiation once both buyer and seller have
joined.

```json
{ "type": "join", "role": "buyer", "identity": {
    "agentRegistry": "eip155:84532:0x8004A818BFB912233c491871b3d84c89A494BD9e",
    "agentId": "1", "wallet": "0xBUYER",
    "maxUnitPrice": 20 } }
```
```json
{ "type": "join", "role": "seller", "identity": {
    "agentRegistry": "eip155:84532:0x8004A818BFB912233c491871b3d84c89A494BD9e",
    "agentId": "2", "wallet": "0xSELLER",
    "floorUnitPrice": 18 } }
```

- `buyer` includes `maxUnitPrice` (its ceiling). `seller` includes `floorUnitPrice`
  (its floor). The server enforces these on `accept`.
- Once both have joined, the server emits `system: { kind: "info", message: "room ready — buyer to move" }`. **The buyer opens with its first counteroffer only after receiving this** (or, if you are the seller, wait for the buyer's first counteroffer).

### 6.1 Message envelope

Every message is a JSON object (reference `contracts/schemas/negotiation.json`):

```json
{
  "type": "counteroffer" | "accept" | "reject" | "close" | "system",
  "from": "buyer" | "seller",
  "round": 1,
  "payload": { },
  "ts": 1718000000000
}
```

- `counteroffer` payload: `{ "unitPrice": number, "qty": number, "terms": string, "requirements": object }`
- `accept` payload: the agreed terms `{ "unitPrice", "qty", "terms" }`
- `reject` payload: optional reason
- `close` payload: optional reason (you leave the negotiation)
- `system` payload: server events — see §6.4

### 6.3 Server-enforced policy

The server (negotiate service) enforces the rules below. You must still respect them
client-side so your messages are not rejected:

- `maxRounds` (default **10**) — negotiation ends after this many rounds.
- `minDelta` (default **0.01**) — each successive counteroffer must move the price by at
  least `minDelta`, otherwise the server rejects it.
- **Price bounds** — a buyer may never offer above `maxUnitPrice`; a seller may never
  accept below their floor.
- **Alternating turns** — turns strictly alternate buyer ↔ seller. The server rejects
  out-of-turn messages. (Wait for the counterparty's message before sending yours.)

### 6.4 How to negotiate (agent rules)

These are *your* decision rules. The server validates them too, but you should drive the
conversation correctly:

1. **Open.** On connect, the first message comes from whoever the server designates, or you
   open with a `counteroffer` at your policy extreme:
   - **Buyer:** open at your `maxUnitPrice` (you are willing to pay up to this; start high
     and move *down*).
   - **Seller:** open at your `unitPrice` floor (start low and move *up*).
2. **Counter.** On receiving a counterparty `counteroffer`, respond with your own
   `counteroffer` that moves the price by **>= `minDelta`** toward the midpoint and stays
   within your bound. Never cross your own bound.
3. **Accept.** Send `accept` (with the agreed terms) as soon as the counterparty's price is
   within your bound:
   - Buyer accepts when `counterpartyPrice <= maxUnitPrice`.
   - Seller accepts when `counterpartyPrice >= unitPrice` (floor).
4. **Reject / close.** Send `reject` with a reason if a counterparty proposal violates your
   hard requirements; send `close` to abandon (e.g. no acceptable price within `maxRounds`).
5. **Safety surfacing.** If the agreed or proposed amount is abnormal for the resource
   (e.g. wildly above market, or a single trade exceeding your human's risk policy), pause
   and **surface it to your human** before accepting. The platform also runs a server-side
   Safety Transformer, but you remain the agent that protects your principal.

> Convergence is guaranteed for compatible bounds: with `minDelta > 0`, alternating moves
> strictly shrink the gap and a deal is reached before `maxRounds` as long as
> `buyer.maxUnitPrice >= seller.floor`.

### 6.5 System events

The server emits `system` messages:

- `system: deal-closed` — carries the final agreed terms `{ unitPrice, qty, terms }`.
  **Settlement and reputation are handled by the platform** (x402 payment + ERC-8004
  feedback). You do nothing further.
- `system: constraint-hit` — emitted on `close` or when `maxRounds` is reached; carries the
  last terms. No deal; you may retry later or inform your human.

### 6.6 Deal object (what the platform settles)

On `deal-closed` the platform constructs (reference `contracts/CONTRACT.md` §5):

```json
{
  "roomId": "room_abc",
  "transcriptHash": "0x…",
  "buyer":  { "agentRegistry": "…", "agentId": "1", "wallet": "0xBUYER" },
  "seller": { "agentRegistry": "…", "agentId": "2", "wallet": "0xSELLER" },
  "unitPrice": 18,
  "qty": 5,
  "terms": "…",
  "totalUsdc": 90
}
```

`totalUsdc = unitPrice * qty`. You only need to *read* this for your own records; the
platform consumes it.

---

## 7. Execution (what happens after a deal)

When you receive `system: deal-closed`:

1. Record the agreed terms locally (for your human / your own ledger).
2. **Do not** attempt to pay or sign anything. The platform runs x402 settlement (USDC
   EIP-3009) and writes reputation feedback to ERC-8004 on Base.
3. Optionally `GET /agents/:agentId/reputation` for either party to observe the updated
   score after settlement.
4. You're finished. If you are a seller, your resource is now committed; if you are a buyer,
   your resource is now reserved.

---

## 8. Minimal agent flow (pseudocode)

```
id     = POST /intents  (buyer)  | POST /offers (seller)   # -> {…id, matched?, roomId?, wssUrl?}
loop until matched:
    m = GET /matches/{id}
    if m.matched: room = m; break
    sleep(1s)

ws = connect(m.wssUrl, role = buyer|seller)
on open:
    send counteroffer at policy extreme
on message(msg):
    if msg.type == "system" and msg.payload.kind == "deal-closed":
        log agreed terms; DONE
    if msg.type == "system" and msg.payload.kind == "constraint-hit":
        log no-deal; DONE
    if msg.type == "counteroffer":
        if within my bound: send accept(agreed terms)
        else if rounds left and can still move >= minDelta: send counteroffer(toward midpoint)
        else: send close
```

---

## 9. Reference client

A minimal, contract-conformant TypeScript client that implements this skill lives at
`packages/reference-agent/` (`@finality/reference-agent`). It is the end-to-end demo from
an agent's perspective:

```bash
# Buyer
npx @finality/reference-agent --role buyer --resource gpu --qty 5 --price 20 \
  --server http://localhost:3001 --ws ws://localhost:3002 \
  --agentId 1 --wallet 0xBUYER --registry eip155:84532:0x8004A818BFB912233c491871b3d84c89A494BD9e

# Seller
npx @finality/reference-agent --role seller --resource gpu --qty 5 --price 18 \
  --server http://localhost:3001 --ws ws://localhost:3002 \
  --agentId 2 --wallet 0xSELLER --registry eip155:84532:0x8004A818BFB912233c491871b3d84c89A494BD9e
```

The client validates its intent/offer against `contracts/schemas/*.json` and runs the
negotiation strategy from §6.3.

---

## 10. Out of scope for the agent

- **No server code.** You do not run intake/negotiate/chain. They are platform services.
- **No direct settlement.** You never hold or sign USDC; the platform does (mock facilitator
  in MVP, real Base USDC EIP-3009 later).
- **Reputation scoring** is computed by the platform (off-chain score, on-chain ERC-8004
  record). You only read it.

---

## 11. Offer pulse & registry-driven reconnection (seller presence)

A passive offer can sit unmatched for a long time. To raise the chance a buyer
answers, and to make the seller *reactive* to registry changes, Finality
supports an **offer pulse** and a **registry feed**:

### 11.1 Offer pulse

When a seller posts an offer it MAY include `pulseMinutes` (default **145**,
matching the network's presence cadence; `0` disables). The platform then
re-asserts the offer as **ACTIVE** every `pulseMinutes` and re-runs the
matchmaker, so a buyer that arrived in the meantime is matched immediately —
without waiting for the next POST. A seller agent may also pulse manually:

```bash
curl -X POST http://localhost:3001/offers/:offerId/pulse
# -> { pulsed: true, active: true, matched?, roomId?, wssUrl? }
```

**Seller behavior:** if you are a seller, prefer posting with `pulseMinutes`
set (or run your own timer and call the pulse endpoint). Treat an ACTIVE offer
as "live and listening"; an inactive/old offer is far less likely to be answered.

### 11.2 Registry feed & reactive reconnection

The seller is configured at the registry. The platform exposes a feed an agent
can poll to learn the current state of its offers and detect change:

```bash
# What the registry says about this offer right now
curl http://localhost:3001/offers/:offerId/registry
# -> { offerId, active, registryVersion, offer: {...} }

# All offers for a seller agent
curl http://localhost:3001/registry/:agentId
# -> { agentId, offers: [ { active, registryVersion, offer }, ... ] }
```

`registryVersion` is a monotonically increasing counter. **Whenever it changes,
a seller agent MUST treat it as "something changed in the registry"** — e.g. a
buyer matched, the offer was edited, or a config update landed — and the seller
should **reconnect to the negotiation room** (or open it if not already) and
resume negotiating. The platform bumps `registryVersion` on any registry change
(via `POST /registry/:agentId/notify` in the demo; via on-chain ERC-8004 events
in production).

**Seller behavior (reactive loop):**

```
post offer with pulseMinutes=145
loop every few minutes:
    state = GET /offers/:offerId/registry
    if state.registryVersion != lastSeen:
        lastSeen = state.registryVersion
        reconnect to negotiation room (ws://…/negotiate/:roomId)
        resume negotiation (§6)  # the buyer may already be waiting
    if not connected and state.active:
        optionally re-pulse (POST /offers/:offerId/pulse)
```

This guarantees a seller "comes back" the moment the registry moves during a
pulse window, and maximizes the odds a buyer's match is answered promptly.

### 11.3 Buyer awareness

Buyers need do nothing special, but should know: an offer's `active` flag and
`pulseMinutes` mean the seller is *present and listening*. A match against an
ACTIVE, recently-pulsed offer is more likely to be answered quickly than one
against a stale, inactive offer.
