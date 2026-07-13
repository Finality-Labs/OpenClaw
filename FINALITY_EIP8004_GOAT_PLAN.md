# Finality × EIP-8004 × GOAT AgentKit — What these are, how they help, and what to implement

> Sources used (all read directly):
> - EIP-8004 spec: https://eips.ethereum.org/EIPS/eip-8004
> - GOATNetwork/agentkit repo: https://github.com/GOATNetwork/agentkit (README + tree + plugin source)
> - Prior context: x402 docs (docs.x402.org) and the "Finality Workflow Transformation Artifact"
>
> Goal: explain EIP-8004 and GOAT AgentKit, map them to the Finality Agent Network, give pros/cons, and list concrete things to implement. This is a companion to `FINALITY_x402_PROOF_PLAN.md` and `FINALITY_MVP1_PLAN.md`.

---

## 1. TL;DR for the project

| Layer in Finality | Best-fit standard / tool | Status today in our plan |
|---|---|---|
| Agent discovery + identity + trust | **EIP-8004** (Identity/Reputation/Validation registries) | MVP1 has a *placeholder* reputation; EIP-8004 is the real upgrade |
| Negotiation (intent ↔ offer ↔ plan) | **Finality's own** (MVP2) | Not covered by any external standard — ours to build |
| Safety Transformer / human-approval gate | **GOAT `PolicyEngine`** (risk levels + `requiresConfirmation`) | This is a ready-made implementation of our $50-vs-$500 guard |
| Settlement / pay-for-access | **x402** | Already chosen in `FINALITY_x402_PROOF_PLAN.md` |
| Runtime pipeline (policy→validate→idempotency→retry→hooks) | **GOAT `ExecutionRuntime`** | Pattern to adopt regardless of chain |
| On-chain agent identity + human-readable names | **GOAT `.goat` GNS** + EIP-8004 Identity Registry | Optional convenience layer |

**Key insight:** GOAT AgentKit is the single SDK that already implements **both** x402 (payer + merchant) **and** ERC-8004 (register-agent, give-feedback, get-reputation) as typed actions, plus a production-grade policy/validation runtime. It is effectively a reference implementation of the exact stack Finality needs. You can build Finality on top of it (fastest) or copy its patterns onto Base/Solana (if you want a non-GOAT chain).

---

## 2. What is EIP-8004?

**ERC-8004: "Trustless Agents"** — a Draft ERC (created 2025-08-13, authors include Marco De Rossi / MetaMask, Davide Crapis / Ethereum Foundation, Erik Reppel / Coinbase). It uses blockchains to **discover, choose, and interact with agents across organizational boundaries without pre-existing trust** — enabling open agent economies.

Required EIPs: EIP-155, EIP-712, EIP-721, EIP-1271.

### The three registries (deployable as per-chain singletons on any L2 or Mainnet)

**A. Identity Registry** — ERC-721 with `URIStorage`.
- Each agent = an `agentId` (the ERC-721 `tokenId`), globally identified by `agentRegistry = {namespace}:{chainId}:{identityRegistry}` (e.g. `eip155:1:0x742...`).
- `agentURI` resolves to a JSON **registration file** describing the agent: name, description, `services` (web / A2A / MCP / OASF / ENS / DID / email endpoints), `x402Support` (bool), `active`, linked `registrations`, and `supportedTrust` (e.g. `["reputation","crypto-economic","tee-attestation"]`).
- Owner of the NFT = owner of the agent; can transfer or delegate to operators.
- Reserved on-chain metadata `agentWallet` = where the agent receives payments; set via `setAgentWallet` with an EIP-712 (EOA) or ERC-1271 (smart wallet) signature. `getMetadata`/`setMetadata` allow extra on-chain metadata.
- Optional endpoint-domain verification via `.well-known/agent-registration.json`.

**B. Reputation Registry** — signed feedback signals.
- `giveFeedback(agentId, int128 value, uint8 valueDecimals, tag1, tag2, endpoint, feedbackURI, feedbackHash)` — value is a signed fixed-point score (e.g. 87/100 → `value=87, decimals=0`; 99.77% → `9977, 2`). `tag1/tag2` are free-form for filtering (quality, uptime, successRate, responseTime, revenues, tradingYield…).
- **You cannot review your own agent** (submitter must not be owner/operator) — Sybil guard.
- `revokeFeedback`, `appendResponse` (agent can append a refund/response), and rich read functions (`getSummary`, `readAllFeedback`, `getClients`, `getLastIndex`).
- Feedback can embed `proofOfPayment` (fromAddress/toAddress/chainId/txHash) — **this is the documented bridge to x402**: payment proof enriches reputation signals.
- Aggregation/scoring is intentionally **off-chain** (complex algos); on-chain only stores raw signals for composability.

**C. Validation Registry** — request independent verification.
- `validationRequest(validatorAddress, agentId, requestURI, requestHash)` — agent asks a validator to check its work.
- `validationResponse(requestHash, response 0–100, responseURI, responseHash, tag)` — validator replies (can be progressive: "soft finality" / "hard finality" via `tag`).
- Validators can be stake-secured re-execution, zkML verifiers, or TEE oracles. Incentives/slashing are left to specific validation protocols (out of scope of the registry).

### What EIP-8004 explicitly says about payments
> "Payments are orthogonal to this protocol and not covered here. However, examples are provided showing how x402 payments can enrich feedback signals."

So **EIP-8004 + x402 are designed to be paired**: x402 moves money, EIP-8004 records trust/discovery, and x402 payment proofs feed reputation.

---

## 3. What is GOAT AgentKit?

TypeScript SDK (the GOAT Network counterpart to Coinbase AgentKit) that lets AI agents autonomously execute on-chain operations on the **GOAT chain (a Bitcoin L2)**. Repo: `GOATNetwork/agentkit` (TypeScript, ~4★, actively developed). It is notable because it ships **working implementations of both x402 and ERC-8004**.

### Four-layer architecture
| Layer | Responsibility | Key file |
|---|---|---|
| **Core** | Runtime engine: Policy → Validation → Idempotency → Retry → Metrics → Timeout → Hooks | `core/runtime/execution-runtime.ts` |
| **Plugins** | 15 feature modules / **118 Actions** (each plugin = a group of Actions) | `plugins/*/actions/*.ts` |
| **Adapters** | Convert Actions into 5 AI frameworks (OpenAI, LangChain, MCP, Vercel AI, OpenAI Agents) | `adapters/*/tools.ts` |
| **Providers** | Action registration, discovery, JSON-Schema tool manifest generation | `providers/action-provider.ts` |

### The plugins that matter for Finality
- **`x402`** (5 actions): `payment.create` / `submit-signature` / `transfer` / `status` / `cancel` — Agent as **payer**, EIP-712 signing flow, `HttpMerchantGatewayAdapter` + `EvmPayerWalletAdapter`.
- **`x402-merchant`** (30 actions): full merchant portal (auth, dashboard, orders, balance, webhooks, API keys, callback contracts, invite codes, audit logs). This is the **seller side** of x402.
- **`erc8004`** (9 actions): `register-agent` / `set-agent-uri` / `get-metadata` / `set-metadata` / `get-agent-wallet` / `give-feedback` / `revoke-feedback` / `get-reputation` / `get-clients` — a complete EIP-8004 client.
- **`gns`** (15 actions): GOAT Name Service (`.goat` ENS-style names) with **cross-chain x402 registration**.
- Others: wallet(10), bridge(7), dex/OKU(7), giftcard(8, real x402 consumer flow), layerzero(3), bitvm2(10), erc721(3), wgbtc(3), goat-token(3), faucet(2), bitcoin(3).

### The runtime engine (your Safety Transformer, already built)
Execution pipeline: **Policy Gate → Schema Validation (Zod) → Idempotency → Retry → Timeout → Metrics → Hooks**.
- `PolicyEngine` evaluates `{allowedNetworks, maxRiskWithoutConfirm, writeEnabled}`. Each action has a `riskLevel` (`read|low|medium|high`) and `requiresConfirmation`. If risk exceeds `maxRiskWithoutConfirm` and not `confirmed` → **blocked**. This is *exactly* the "$50-vs-$500, ask a human for big trades" gate from your artifact — implemented.
- `ExecutionHooks`: `onActionStart` / `onActionSuccess` / `onActionError` / `onPolicyBlocked` — observation callbacks (where you'd plug human-approval UIs).
- Idempotency (memory/Redis, Lua atomic lock), Prometheus `/metrics`, sensitive-field redaction, revealed-output gating.

### EIP-8004 contract addresses in GOAT AgentKit
- `goat-mainnet`: Identity `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`, Reputation `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`
- `goat-testnet`: Identity `0x556089008Fc0a60cD09390Eca93477ca254A5522`, Reputation `0xd9140951d8aE6E5F625a02F5908535e16e3af964`
- (CREATE2 deterministic `0x8004…` on mainnet.)

### Example: registering an agent + giving feedback (from GOAT source)
```typescript
// erc8004.register_agent  (riskLevel: 'high', requiresConfirmation: true)
wallet.writeContract(getIdentityRegistryAddress(network),
  ['function register(string agentURI) returns (uint256 agentId)'],
  'register', [agentURI]);

// erc8004.give_feedback  (riskLevel: 'medium', requiresConfirmation: true)
wallet.writeContract(getReputationRegistryAddress(network), GIVE_FEEDBACK_ABI, 'giveFeedback',
  [BigInt(agentId), value, valueDecimals, tag1, tag2, endpoint, feedbackURI, feedbackHash]);

// erc8004.get_reputation  (riskLevel: 'read')
const [count, summaryValue, summaryValueDecimals] =
  await wallet.callContract(addr, GET_SUMMARY_ABI, 'getSummary', [BigInt(agentId), clientAddresses, tag1, tag2]);
```

---

## 4. How these help YOUR project (Finality Agent Network)

Your artifact defines an 8-stage flow: Claim → Profile → Publish → Discover → Negotiate → Plan → Settle → Reputation.

| Stage | Without these | With EIP-8004 + GOAT |
|---|---|---|
| Claim / Profile | Local mock agent record | **EIP-8004 Identity Registry** = portable, censorship-resistant on-chain agent identity; `agentURI` holds the same profile/skills/endpoints your artifact describes |
| Publish / Discover | Our own markets list | **EIP-8004 discovery** = cross-org agent/service discovery (any client can find agents by trust model, not just our walled garden) |
| Negotiate | Finality's own (MVP2) | Still ours — neither standard covers negotiation |
| Plan / Settle | Planned x402 | **GOAT `x402` plugin** = payer + merchant; EIP-712 signing; proof-of-payment feeds reputation |
| Reputation | MVP1 *placeholder* | **EIP-8004 Reputation Registry** = real, composable, on-chain feedback; `get-reputation` replaces our stub; off-chain aggregation = our scoring algo |
| Safety / human gate | Planned policy engine | **GOAT `PolicyEngine`** = risk-gated execution + `requiresConfirmation` = the Safety Transformer, done |

This collapses three of our hardest "build from scratch" problems (identity, reputation, payment + safety) into **adopt-don't-build** decisions.

---

## 5. Pros and Cons

### EIP-8004 — pros
- **Standardized cross-org discovery + trust** — exactly the "market operating system for autonomous agents" your artifact wants. Agents become discoverable beyond your app.
- **Three pluggable, tiered trust models** (reputation / validation+zkML / TEE) — security scales with value at risk.
- **Composable on-chain reputation** — any smart contract can read `getSummary`; enables insurance pools, auditor networks, lender-style scoring.
- **Explicitly orthogonal to payments but x402-aware** — `proofOfPayment` in feedback ties money to trust cleanly.
- **Portable, censorship-resistant identity** (ERC-721); transferable with NFT tooling; `agentWallet` proves payment destination with signature.
- **Already implemented** (GOAT `erc8004` plugin, 9 working actions) — not just a paper spec.

### EIP-8004 — cons
- **Draft** (Aug 2025) — API/ABI may change before final.
- **Sybil attacks acknowledged**; you must build reviewer reputation / filter by `clientAddresses` or spam inflates scores. `getSummary` without client filtering is explicitly Sybil-prone.
- **Does NOT guarantee capabilities are functional or non-malicious** — only that the registration file matches the on-chain agent. You still need validation/TEE for "is this agent actually good."
- **On-chain feedback costs gas** (mitigated by EIP-7702 sponsorship; still a UX/cost factor).
- **Scoring is off-chain** — you still own the aggregation algorithm (the valuable IP).
- **Validation incentives/slashing are out of scope** — you build or integrate a validator network.

### GOAT AgentKit — pros
- **Implements BOTH x402 and ERC-8004** as typed SDK actions — the single fastest path to our full stack.
- **Production-grade runtime**: Policy → Validation → Idempotency → Retry → Metrics → Hooks. Not demo-grade.
- **PolicyEngine = our Safety Transformer, already written**: risk levels + `requiresConfirmation` + human gate via hooks.
- **5 framework adapters** (OpenAI / LangChain / MCP / Vercel AI / OpenAI Agents) — define an Action once, expose everywhere (including MCP, which matches our "wire agent" idea).
- **x402 merchant portal (30 actions)** + a real consumer flow (giftcard, cross-chain USDC/USDT) — proven payer+merchant.
- **`.goat` naming** (ENS-style) for human-readable agent names; cross-chain x402 registration.
- **Defense-in-depth in payments**: 3-way payer binding (`wallet ≡ payer ≡ signed message.payer`), status gates, token allowlists, sensitive-field redaction.
- **Unique Bitcoin-L2 positioning** (BitVM2 + Bridge.sol + BTC light client) — a track Base/Coinbase AgentKit doesn't cover.

### GOAT AgentKit — cons
- **Tied to GOAT Network (Bitcoin L2, testnet3 chainId 48816)** — if you want Base/Solana (per x402 docs + your installed toolchains), you must adapt the wallet/network layer or use the upstream `x402/typescript` SDK + deploy ERC-8004 yourself.
- **Small community** (~4★, new) — less battle-testing, fewer third-party examples than Coinbase's x402.
- **Reputation registry "may not all be available yet" on testnet** — verify deployment before relying on it.
- **Heavy if you only want a slice** — 118 actions / 15 plugins; tree-shake or use `minimal` preset (wallet only) if needed.
- **GOAT-specific assumptions** (GOAT tokens, bridge, BitVM2) leak into some plugins; the x402 + erc8004 plugins are chain-agnostic enough to reuse.

---

## 6. What we can implement in our project (concrete)

### Option A — Build ON GOAT AgentKit (fastest, recommend for a spike)
1. `npm create goat-agent` → `full` preset (118 actions) on `goat-testnet`.
2. Replace our MVP1 mock agent record with **`erc8004.register_agent`** + `set-agent-uri` (agentURI points to our registration JSON — same shape as the artifact's profile/skills).
3. Replace MVP1 reputation placeholder with **`erc8004.give_feedback` / `get-reputation`**. Off-chain aggregation = our scoring service (keeps IP in-house).
4. Use **`x402` payer actions** for the buyer and **`x402-merchant`** for the seller — this is our MVP3→MVP4 settlement, already built.
5. Wrap every money action in **`PolicyEngine`** with `maxRiskWithoutConfirm:'low'` and `requiresConfirmation:true` for `high` — this IS the Safety Transformer + human-approval gate. Plug a human-approval UI into `onPolicyBlocked` / `onActionStart`.
6. Expose the whole thing to our "Hermes wire agent" via the **MCP adapter** (`provider.mcpTools()`).

### Option B — Adopt patterns, deploy on our chosen chain (Base/Solana)
- Use GOAT's **source as reference**, but:
  - Deploy EIP-8004 registries on **Base** (or our chain) — addresses are config, not hardcoded to GOAT.
  - Use upstream **`x402/typescript`** SDK for payments (Base USDC, EIP-3009) per `FINALITY_x402_PROOF_PLAN.md`.
  - Port the **PolicyEngine + ExecutionRuntime** pattern (it's generic TS, not GOAT-chain-specific) into our `packages/server` as our safety/execution layer.
  - Keep GOAT's `erc8004` plugin actions as the client (they take a `WalletProvider` + network — swappable).

### What stays OURS (nobody else provides it)
- **Negotiation engine (MVP2):** structured counteroffers, turn limits, minimum delta, transcript hashes. Neither EIP-8004 nor x402 touches this.
- **Execution-plan builder:** turning a negotiated deal into a machine-readable plan that x402 settles.
- **Off-chain reputation scoring:** the aggregation algorithm over EIP-8004 raw signals.
- **Validation network:** zkML/TEE validators for the Validation Registry (MVP4+).
- **Product UX:** markets, discovery UI, Claim/Profile pages (already planned in MVP1).

---

## 7. Proof plan — a money-free spike proving EIP-8004 + x402 + PolicyEngine fit

Goal: on **goat-testnet** (or mocked), prove (1) an agent registers via ERC-8004 and is discoverable, (2) a buyer pays a seller via x402, (3) the seller receives EIP-8004 feedback, (4) a large payment is **blocked by PolicyEngine until human confirms**.

- **S1** Scaffold `packages/goat-proof` with `@goatnetwork/agentkit`, `NoopWalletProvider` (dev) + `ViemWalletProvider` (testnet).
- **S2 (TDD)** Register a buyer + seller agent via `erc8004.register_agent` with an `agentURI` JSON matching our artifact profile. Assert `txHash` returned; `get-clients` later shows them.
- **S3 (TDD)** Buyer pays seller via `x402.payment.create` → `submit-signature` → merchant `orders.*` flow (use `x402-merchant` or mock). Assert a settlement/payment record exists.
- **S4 (TDD)** Buyer calls `erc8004.give_feedback` (value=100, tag1='quality') → `get-reputation` returns `summaryValue` reflecting it. (Proves x402 payment → EIP-8004 reputation bridge.)
- **S5 (TDD)** Wrap the payment in `PolicyEngine({ maxRiskWithoutConfirm:'low', writeEnabled:true })` with `requiresConfirmation:true` on the x402 action. Assert: small payment auto-allowed; **large payment blocked** (`allowed:false, reason:'Confirmation required'`) until `confirmed:true` is passed (human gate). This is the Safety Transformer, proven.
- **S6** Script `npm run proof` prints: registered agents, paid + feedback loop, and the blocked-vs-confirmed large payment. Zero real funds (testnet/Noop).
- **S7** Write `GOAT_EIP8004_PROOF.md` + update `FINALITY_MVP1_PLAN.md` reputation task to point at EIP-8004.

Validation criteria (all must hold):
- [ ] Agent registered on-chain and resolvable via `agentURI`.
- [ ] x402 payment completes payer→merchant with EIP-712 signature.
- [ ] Feedback recorded and `get-reputation` reflects it.
- [ ] PolicyEngine blocks an over-risk payment without confirmation; allows after `confirmed`.
- [ ] No real mainnet funds moved.

---

## 8. Decision summary

| Question | Answer |
|---|---|
| What is EIP-8004? | On-chain **identity + reputation + validation** registries for trustless agent discovery. Pairs with x402 (payments orthogonal). |
| What is GOAT AgentKit? | TS SDK implementing **x402 + ERC-8004 + a policy/validation runtime** on a Bitcoin L2. A ready reference stack for Finality. |
| How do they help us? | Collapse 3 hard build-from-scratch problems (identity, reputation, pay+safety) into adopt-don't-build. |
| Pros | Standardized trust/discovery; composable on-chain rep; x402-aware; GOAT gives working code + production runtime + human-gate PolicyEngine. |
| Cons | EIP-8004 is draft + Sybil-prone + off-chain scoring; GOAT is GOAT-chain-locked + small community + testnet registry gaps. |
| What to implement? | Option A: build on GOAT AgentKit (fastest). Option B: port patterns to Base/Solana. Either way: negotiation + scoring + validation stay ours. |
| Biggest win | The **PolicyEngine** is literally our Safety Transformer + human-approval gate, already written. |
| Recommended next step | Run the S1–S7 spike on goat-testnet to prove the ERC-8004 + x402 + PolicyEngine fit before committing MVP3/MVP4 design. |

---

## 9. Open questions for you
1. **Chain choice:** GOAT Network (Bitcoin L2, fastest via AgentKit) vs Base/Solana (per x402 docs + your env)? This decides Option A vs B.
2. **Reputation scoring:** do you want to own the off-chain aggregation algorithm, or use/extend an existing EIP-8004 reputation service?
3. **Validation:** is zkML/TEE validation in scope for MVP4, or later? It's the only piece EIP-8004 references but doesn't ship.
4. **Human gate placement:** confirm the approval UI lives in the *buyer agent's* policy layer (recommended) — GOAT's `onPolicyBlocked` hook is the integration point.
