# Finality × ERC-8004 (official contracts) — How to use it, Pros/Cons

> New primary sources (read directly this round):
> - Official contracts repo: https://github.com/erc-8004/erc-8004-contracts  (226★, CC0, "Registry contracts curated by the 8004 team")
> - Site: https://www.8004.org/  ("Trustless Autonomous Agents on Open Protocols")
> - ABIs: `abis/IdentityRegistry.json`, `abis/ReputationRegistry.json`, `abis/ValidationRegistry.json`
> - Deployments: README lists **~40 chains** with deterministic `0x8004…` addresses
> - Companion docs already saved: `FINALITY_EIP8004_GOAT_PLAN.md`, `FINALITY_x402_PROOF_PLAN.md`, `FINALITY_MVP1_PLAN.md`
>
> This round focuses on the **official erc-8004 contracts** and how Finality should adopt them — including fixes to the GOAT-centric view from the previous plan.

---

## 1. What this repo is (and why it changes the plan)

`erc-8004/erc-8004-contracts` is the **canonical, official implementation** of ERC-8004, curated by the 8004 team (coordinated by Marco De Rossi/MetaMask, Davide Crapis/EF, with Jordan Ellis/Google and Erik Reppel/Coinbase). Key facts:

- **License: CC0 (public domain).** You can deploy, fork, or integrate freely.
- **Already deployed to ~40 chains** — not just GOAT. Mainnet identity address `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` and reputation `0x8004BAa17C55a88189AE136b182e5fdA19dE9B63` are **identical across Ethereum, Base, Arbitrum, Optimism, Polygon, Avalanche, BSC, Celo, Gnosis, Linea, Mantle, MegaETH, Metis, Monad, Scroll, SKALE, Soneium, Taiko, XLayer, Hedera, 0G, Billions, Injective, GOAT Network, Abstract**, and more. Testnet (`0x8004A818…` / `0x8004B663…`) on Sepolia, Base Sepolia, etc.
- **Upgradeable** (UUPS `ERC1967Proxy`, `upgradeToAndCall`, `UPGRADE_INTERFACE_VERSION`) — contracts can be upgraded by owner; `getVersion()` exposes current version.
- **Ship shape:** `contracts/` (3 registries), `abis/`, `ignition/modules` (deployment), `scripts/` (CREATE2 vanity deploy, triple-presigned upgrade), `test/` (core/local/upgradeable).
- **Validation Registry is still "under active update / discussion with the TEE community"** — the README explicitly warns it will be revised later this year. So Identity + Reputation are production-ready; Validation is not yet final.

**Correction to the previous plan:** last round I noted GOAT AgentKit is "tied to GOAT Network." That's only true of GOAT's *default config*. The official registries are **chain-agnostic deployed singletons** — so Finality can use ERC-8004 on **Base** (matching the x402 docs + your env) by simply pointing at `0x8004…` on Base. No need to deploy your own or be locked to GOAT.

---

## 2. The contracts (from the ABIs)

### Identity Registry (`abis/IdentityRegistry.json`) — ERC-721 upgradeable
- `register()`, `register(string agentURI)`, `register(string, tuple[] metadata)` → returns `uint256 agentId`
- `setAgentURI(agentId, uri)`, `tokenURI(agentId)`
- `getAgentWallet(agentId)`, `setAgentWallet(agentId, newWallet, deadline, signature)` (EIP-712/ERC-1271), `unsetAgentWallet(agentId)`
- `getMetadata(agentId, key)`, `setMetadata(agentId, key, value)`, event `MetadataSet`
- ERC-721 standard: `ownerOf`, `transferFrom`, `safeTransferFrom`, `approve`, `setApprovalForAll`
- Events: `Registered(uint256 agentId, string agentURI, address owner)`, `URIUpdated`, `MetadataSet`

### Reputation Registry (`abis/ReputationRegistry.json`)
- `giveFeedback(agentId, int128 value, uint8 valueDecimals, tag1, tag2, endpoint, feedbackURI, feedbackHash)`
- `revokeFeedback(agentId, feedbackIndex)`, `appendResponse(...)`
- Reads: `getSummary(agentId, address[] clientAddresses, tag1, tag2) → (count, summaryValue, summaryValueDecimals)`, `readFeedback`, `readAllFeedback`, `getClients`, `getLastIndex`, `getResponseCount`
- Events: `NewFeedback(...)`, `FeedbackRevoked`, `ResponseAppended`
- **Self-feedback prevented**: `giveFeedback` reverts if the caller is the agent owner/operator (checked via Identity Registry).

### Validation Registry (`abis/ValidationRegistry.json`)
- `validationRequest(validatorAddress, agentId, requestURI, requestHash)` (caller must be agent owner/operator)
- `validationResponse(requestHash, response 0–100, responseURI, responseHash, tag)` (caller must be the requested validator)
- Reads: `getValidationStatus`, `getSummary`, `getAgentValidations`, `getValidatorRequests`
- **Status: not final** — do not build production logic on it yet.

---

## 3. How we use ERC-8004 in Finality (concrete integration)

### 3.1 Replace MVP1's reputation placeholder with real ERC-8004 (Base)
Our MVP1 plan has `ReputationService` returning a stub `{score:0,...}`. Replace it:
- On **agent claim** (stage 1–2 of the artifact), call `IdentityRegistry.register(agentURI)` on **Base** → get `agentId`. Store `agentId` + `agentRegistry = eip155:8453:0x8004A169...` on our agent record.
- `agentURI` points to our registration JSON (same shape the artifact describes: name, description, services [web/A2A/MCP], `x402Support:true`, `supportedTrust:["reputation"]`).
- On **settlement complete** (stage 7), the buyer calls `ReputationRegistry.giveFeedback(agentId, value, decimals, tag1='quality', ...)` with a `proofOfPayment` off-chain file (fromAddress/toAddress/chainId/txHash) — the x402↔ERC-8004 bridge the spec documents.
- Discovery/Profile page reads `getSummary(agentId, [clientAddresses])` for the trust score. **Must pass `clientAddresses`** (non-empty) to avoid Sybil-inflated summaries.

### 3.2 Make agents discoverable cross-org (beyond our walled garden)
Because ERC-8004 is a public singleton, any external client can find our agents. We expose each agent's `agentURI` (registration file) so other ERC-8004-aware apps can discover and trust Finality agents. This is the "market operating system for autonomous agents" the artifact wants.

### 3.3 Use x402 for the money, ERC-8004 for the trust (the designed pairing)
Per the spec: *"Payments are orthogonal… x402 payments can enrich feedback signals."* So:
- **x402** moves USDC (Base, EIP-3009) at settlement.
- **ERC-8004** records the outcome + payment proof as reputation.
- Neither replaces the other; together they close the artifact's stage 7→8 loop (settle → reputation).

### 3.4 Recommended chain: **Base mainnet (or Base Sepolia for MVP3 sim)**
- Base already has the registries deployed at `0x8004…`. No deployment cost. Matches x402's default USDC on Base. Uses your existing env (viem/ethers).
- This removes the GOAT lock-in concern entirely. We can still *use GOAT AgentKit's `erc8004` plugin code* as our client (it takes a `WalletProvider` + network), just pointed at Base.

### 3.5 Validation Registry — defer
Do **not** depend on it for MVP3/MVP4. It's explicitly "under active update." If we need "did the agent actually deliver?" we use x402 `Receipts` + our own ZK-TLS/proof step (from the artifact's MVP4) for now, and revisit Validation Registry when it stabilizes.

---

## 4. Pros and Cons of adopting the official ERC-8004 contracts

### Pros
1. **Authoritative & neutral.** Curated by MetaMask/EF/Coinbase/Google; CC0. Not a single-vendor lock-in. Low risk of the standard dying.
2. **Already deployed on ~40 chains** at identical `0x8004…` addresses — **zero deployment work** on Base/Ethereum/etc. Just point your ABI at the address.
3. **Chain-agnostic** — fixes the GOAT-only worry; use Base (matches x402) or any EVM L2.
4. **Composable on-chain reputation** — `getSummary`/`readAllFeedback` are callable by any contract; enables insurance pools, auditor networks, lender scoring later.
5. **Sybil-resistant by design** — self-feedback blocked; `getSummary` requires `clientAddresses` to reduce spam.
6. **Portable, transferable identity** (ERC-721) with `agentWallet` proving payment destination via signature; `agentURI` supports IPFS/HTTPS/data URIs.
7. **Upgradeable (UUPS)** — the team can fix bugs; `getVersion()` lets us gate features by version.
8. **Clear end-to-end flow** documented in README (register → publish file → setAgentWallet → collect feedback → aggregate).
9. **Pairs cleanly with x402** (the payment-proof bridge is in the spec).
10. **Test suite + Hardhat + Ignition** included — we can fork and test against the real ABIs locally.

### Cons
1. **Draft ERC** (Aug 2025). ABI/behavior may shift before "Final"; UUPS upgrades mean the live contract can change. Pin a known version + monitor `getVersion()`.
2. **Validation Registry not final** — can't rely on it yet for delivery-proof/trust verification.
3. **Sybil still possible** — `getSummary` *without* `clientAddresses` is explicitly Sybil-prone; you must filter by reviewer reputation (which you build). The protocol only standardizes signals, not a magic trust score.
4. **Does NOT guarantee an agent is competent/non-malicious** — only that the registration file matches the on-chain agent. Capability verification still needs validation/TEE (future) or your own checks.
5. **On-chain feedback costs gas** — every `giveFeedback` is a tx. Mitigated by EIP-7702 sponsorship; still a UX/cost factor at scale. Off-chain scoring is where the real algorithm lives (your IP).
6. **Scoring is off-chain** — you still own (and must build) the aggregation/ranking algorithm over raw signals.
7. **Indexing needed** — rich queries (per-tag, per-client) are easier via subgraph/indexer over the events; adds infra.
8. **Wallet/key ceremony** — `setAgentWallet` needs EIP-712/ERC-1271 proofs; `agentWallet` clears on transfer and must be re-verified. More moving parts than a DB row.
9. **Upgrade risk** — because it's upgradeable, a malicious/compromised owner could change logic. Mitigate by reading `getVersion()` and tracking the team; for max safety, you could deploy your own immutable fork (you have the CC0 source).
10. **L2 nuances** — bridging reputation across chains: an agent registered on Base transacts elsewhere; you must decide if reputation is per-chain or aggregated. The spec allows multi-registration.

---

## 5. What we implement vs what we reuse

| Piece | Reuse (don't build) | Build (ours) |
|---|---|---|
| Agent on-chain identity | `IdentityRegistry.register` @ Base `0x8004…` | Registration-file JSON (our agent profile/skills shape) |
| Reputation signals | `ReputationRegistry.giveFeedback` / `getSummary` | Off-chain scoring/aggregation algorithm |
| Payment | x402 (Base USDC, EIP-3009) | Execution-plan → x402 payload mapping |
| Safety / human gate | (GOAT `PolicyEngine` pattern, or our own) | Approval UI on `onPolicyBlocked` |
| Negotiation (MVP2) | — | Ours entirely |
| Validation/delivery proof | (later, when Validation Registry final) | ZK-TLS/proof step for MVP4 |
| Discovery UI | ERC-8004 public singleton | Our Markets/Discover pages read on-chain |

---

## 6. Proof plan — money-free spike on Base Sepolia (updated)

Goal: prove ERC-8004 + x402 fit on **Base** (not GOAT), no real funds.

- **S1** Add `packages/erc8004-proof` with `viem` + the official ABIs. Config: `IDENTITY=0x8004A818BFB912233c491871b3d84c89A494BD9e`, `REPUTATION=0x8004B663056A597Dffe9eCcC1965A193B7388713` (Base Sepolia), or mainnet `0x8004…` on Base.
- **S2 (TDD)** `register` an agent → assert `agentId` returned + `tokenURI` set. (Mirrors MVP1 claim.)
- **S3 (TDD)** `giveFeedback(agentId, 100, 0, 'quality', '', endpoint, feedbackURI, hash)` → `getSummary(agentId, [clientAddress])` returns `summaryValue=100`. Assert self-feedback reverts (Sybil guard).
- **S4 (TDD)** Wire x402 payment (mock facilitator) → after "settlement", write a feedback file with `proofOfPayment` and call `giveFeedback`. Proves the x402→ERC-8004 bridge.
- **S5 (TDD)** Policy gate: wrap `giveFeedback`/payment in a risk policy (`requiresConfirmation` for large value) → large value blocked until confirmed (human gate).
- **S6** Script prints: registered agent, reputation score, payment→feedback loop, blocked-vs-confirmed. Zero mainnet funds.
- **S7** Write `FINALITY_ERC8004_BASE_PROOF.md`; update `FINALITY_MVP1_PLAN.md` reputation task to point at Base `0x8004…`.

Validation (all must hold):
- [ ] Agent registered on Base `0x8004…` Identity Registry.
- [ ] Feedback recorded; `getSummary` reflects it; self-feedback reverted.
- [ ] x402 payment proof attached to feedback.
- [ ] Policy gate blocks over-risk action until confirmation.
- [ ] No real mainnet funds moved.

---

## 7. Decision summary

| Question | Answer |
|---|---|
| What is `erc-8004/erc-8004-contracts`? | The **official, CC0, MetaMask/EF/Coinbase-curated** ERC-8004 implementation — already deployed to ~40 chains at `0x8004…`. |
| Does it lock us to GOAT? | **No.** Point at Base `0x8004…`; use GOAT's *plugin code* as a client if desired, but the registry is chain-agnostic. |
| Where do we use it? | Replace MVP1 reputation placeholder; agent identity at claim; payment-proof feedback at settlement; cross-org discovery. |
| Pros | Authoritative/neutral, zero-deploy on Base, composable rep, Sybil-guarded, upgradeable, x402-pairing. |
| Cons | Draft + upgradeable (version risk), Validation Registry not final, Sybil needs reviewer filtering, gas for feedback, scoring off-chain (your IP), indexer infra. |
| Recommended chain | **Base** (matches x402 USDC; registries already live). |
| Next step | Run the S1–S7 Base-Sepolia spike to prove the fit before MVP3/MVP4. |

---

## 8. Open questions
1. **Base vs Ethereum mainnet** for the registries — Base is cheaper and matches x402; Ethereum is maximally neutral. Recommend Base.
2. **Per-chain vs aggregated reputation** — do we treat an agent's Base reputation and (say) Solana reputation as separate or merged?
3. **Indexer** — do we run a subgraph/thegraph for rich reputation queries, or read `getSummary` directly (simpler, less flexible)?
4. **Own immutable fork vs use the upgradeable singleton** — fork gives immutability but you lose upstream fixes; singleton gives fixes but upgrade risk. Recommend: use the singleton + pin `getVersion()`.
