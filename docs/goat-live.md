# GOAT Network — going LIVE (runbook)

Everything is already wired. The moment you have a funded GOAT testnet key, this
is the whole flow — zero extra code changes needed.

## 1. Fund a key (one-time)
- Create / reuse a GOAT testnet wallet. The funded **private key** signs
  settlement + ERC-8004 txs; this wallet pays testnet gas (and the settle token
  if `GOAT_SETTLE_TOKEN` is set).
- Get testnet GOAT from the GOAT testnet faucet. (RPC is bundled:
  `https://rpc.testnet3.goat.network`, chainId 48816 — no RPC key needed.)
- Pick a `GOAT_SELLER_WALLET` = a real address you control, to receive the test
  payment (so you can watch funds arrive + see it on the explorer).

## 2. Configure (.env at repo root — already gitignored)
```
cp .env.example .env
```
Set:
```
CHAIN_MODE=live
GOAT_PRIVATE_KEY=0x....            # funded testnet key (64 hex chars)
GOAT_SELLER_WALLET=0x....          # address you control (receives settlement)
# optional: GOAT_SETTLE_TOKEN=0x..  + GOAT_TOKEN_DECIMALS=6  (pay in a token)
# optional: GOAT_AGENT_URI=https://.../agent.json
```
Keep `unitPrice*qty <= 50` — the Safety Transformer blocks deals over
`maxSingleTrade` (DEFAULT_POLICY, $50). Use smaller numbers to prove a clean close.

## 3. Run the full live proof (register + settle + reputation, on-chain)
```
npm -w packages/orchestrator run proof:live
```
What it does, against the REAL chain:
- Registers **buyer + seller** on the ERC-8004 Identity Registry (live txn,
  returns numeric `agentId` per agent).
- Posts intent + offer → match → two agents negotiate → deal closes.
- **Settles** a real transfer to `GOAT_SELLER_WALLET` (native or token) → prints
  `txHash` + explorer URL.
- Records **ERC-8004 giveFeedback** for both + reads back `getSummary`.
On success it prints `✅ LIVE PROOF PASS: on-chain register + settle + ERC-8004 reputation.`

## 4. Or run the UI in live mode
```
npm -w packages/orchestrator run ui:live
```
Open http://localhost:3000 — the dashboard shows a green `settlement: live
(goat-testnet)` badge. Every "Run deal" then settles + records reputation on
GOAT. (Note: the UI's quick-deal form doesn't register agents first, so via the
UI you get live settlement; via `proof:live` you get live settlement **and**
ERC-8004 reputation, because it registers the agents up front.)

## Verified without a key (this session)
- `npm run test` green: 49 unit tests + E2E. Mock path untouched by default.
- Live adapter instantiates against the GOAT SDK (chainId 48816, correct
  registries: Identity `0x5560…`, Reputation `0xd914…`).
- `/mode` reports `mock` by default, `live` when configured+ready.
- `/register` returns 422 in mock mode (clear "needs live + key" message).
- UI health reflects chain mode; badge renders green on live.

## Honest notes
- **Custodial settlement**: the server's `GOAT_PRIVATE_KEY` signs the transfer
  (simplest live model). Per-agent EIP-712 x402 signing (each agent signs its
  own payment) is a follow-up; the SDK's `x402` payer actions are available.
- **Reputation sybil guard** (per EIP-8004): an agent cannot review itself, so
  `giveFeedback` is sent by the settler key on behalf of each party — fine for a
  demo; for production you'd sign feedback from each agent's own key.
- **Cost**: testnet gas only. No real money. Flip `GOAT_NETWORK=goat-mainnet` +
  a funded mainnet key for production (config change only).
