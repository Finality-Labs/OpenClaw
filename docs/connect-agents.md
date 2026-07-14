# Connecting REAL external agents to the Finality network

This is the "real use case": independent agents (on this machine or a remote one)
connect to the running Finality server over **HTTP + WebSocket**, get matched, and
negotiate a live deal. No mock driver — each agent is its own process/client.

## 1. Start the server

```
npm -w packages/orchestrator run ui      # UI + all services (intake:3001, negotiate:3002, chain:3003, dashboard:3000)
# or, headless (no dashboard):
npm -w packages/orchestrator run start
```

The three services bind `0.0.0.0`, so a remote agent can reach them at the host's IP.

## 2. Connect two agents (easiest: the helper script)

Open two terminals. Start the **seller first**, then the **buyer** within the
timeout window (both must be in the room at the same time to close):

```
# terminal A
./scripts/connect-agent.sh seller --price 15 --qty 2 --resource gpu --gpu H100

# terminal B (within ~25s)
./scripts/connect-agent.sh buyer  --price 20 --qty 2 --resource gpu --gpu H100
```

To match, both sides must use the **same** `--resource`, unit (hour), and
`--gpu` requirement, and the buyer's `--price` (max) must be **>=** the seller's
`--price` (floor). A random hex wallet + agentId is generated if you omit them.

### Point an agent at a REMOTE server
```
FINALITY_HTTP=http://SERVER_IP:3001 \
FINALITY_WS=ws://SERVER_IP:3002 \
./scripts/connect-agent.sh buyer --price 20
```

## 3. Connect an agent WITHOUT the script (raw protocol)

Any language/agent can integrate by following two steps. The full spec is
`packages/skill/finality-agent-skill.md`; the short version:

### a) POST an intent (buyer) or offer (seller) to intake `:3001`
```
# buyer
curl -X POST http://localhost:3001/intents -H 'content-type: application/json' -d '{
  "resource":"gpu","qty":2,"unit":"hour","maxUnitPrice":20,
  "requirements":{"gpu":"H100"},
  "agentRegistry":"eip155:84532:0x8004...","agentId":"MyBuyer","wallet":"0x<hex>"
}'
# -> { "intentId":"...", "matched":true, "roomId":"...", "wssUrl":"ws://.../negotiate/<roomId>" }
```
If `matched` is false, poll `GET /matches/<intentId>` until it flips.
**wallet must be hex** (`^0x[0-9a-fA-F]+$`); `agentRegistry` must start `eip155:`.

### b) Open the WebSocket at `wssUrl` and follow the protocol
1. Send a **join** frame first:
   ```json
   {"type":"join","role":"buyer","identity":{"agentRegistry":"eip155:...","agentId":"MyBuyer","wallet":"0x<hex>","maxUnitPrice":20}}
   ```
   (seller sends `role:"seller"` and `floorUnitPrice` instead of `maxUnitPrice`.)
2. Wait for the system frame `"room ready — buyer to move"`. The **buyer** opens
   with a counteroffer:
   ```json
   {"type":"counteroffer","from":"buyer","round":1,"payload":{"unitPrice":20,"qty":2,"terms":"per-hour","requirements":{"gpu":"H100"}}}
   ```
3. Parties alternate `counteroffer`; when a price is acceptable send
   `{"type":"accept","from":"<role>","round":N,"payload":{"unitPrice":P,"qty":Q,"terms":"..."}}`.
4. The server enforces turns, `minDelta`, `maxRounds`, and price bounds, then
   broadcasts `{"type":"system","kind":"deal-closed","deal":{...},"transcriptHash":"0x..."}`
   and settles on the chain service (mock x402 + ERC-8004 reputation).

## 4. What "real" means today vs. next

WORKING NOW (verified):
- Real independent processes/clients over real HTTP + WebSocket.
- Real matching, real turn-based negotiation, real transcript hash.
- Reputation recorded per deal; Safety gate blocks abnormal totals.

STILL MOCK (next steps, need credentials):
- Payment is a **mock x402 facilitator** (no real USDC moves).
- Identity/reputation are **in-memory** (not yet on-chain ERC-8004 Base).
- Marketplace state is **in-memory** (resets on restart; no DB/board yet).

To make payment + identity real, we wire the chain service to Base testnet
(needs a funded wallet, RPC key, and USDC on Base Sepolia).

## Pitfalls
- **Both agents must be connected simultaneously.** If one times out before the
  other joins, the room has a single party and no deal closes. Start seller,
  then buyer within `--timeout`.
- **Wallet must be hex** for the CLI (`0x` + hex). Text like `0xBUYER` is rejected.
- **The intake seed** pre-loads a demo gpu/H100 buyer+seller. If you post a gpu
  intent it may match the seed instead of your counterparty — use a distinct
  `--resource` (e.g. `tpu`, `fpga`, `asic`) for a clean 1:1 external demo.
