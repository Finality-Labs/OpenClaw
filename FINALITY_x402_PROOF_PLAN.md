# Finality × x402 — Feasibility, Pros/Cons, and a Proof Plan

> Context: Finality Agent Network (MVP1 "Agent Social Market" already planned in `FINALITY_MVP1_PLAN.md`).
> New input: https://docs.x402.org — the open HTTP-402 payment standard.
> Question from user: Our Hermes wire agent comes, negotiates, then either auto-pays or gets human judgment before payment. Can we use x402, or is something different needed?

**Bottom line up front:** x402 is a strong, near-direct fit for the *settlement* half of your idea (pay-for-access over HTTP, machine-to-machine, agent-native, with a built-in human-approval hook). It does **not** cover the *negotiation* half (the structured counteroffer/plan exchange in your artifact) or your *safety transformer* ($50-vs-$500 policy gate). You should adopt x402 as the payment rail and keep your own negotiation + policy layers on top. This document proves that, lists the real pros/cons, and gives an executable proof plan.

---

## 1. What x402 actually is (from the docs)

- **Open standard** (Apache-2.0), built around HTTP `402 Payment Required`.
- **Roles:** Client (= buyer / agent) requests a resource; Server (= seller) responds `402` with a `PAYMENT-REQUIRED` header (Base64 JSON: amount, network, scheme, destination). Client signs a payment payload, resends with `PAYMENT-SIGNATURE`. Server verifies (+ settles) via a **facilitator** (or locally), then returns the resource with `PAYMENT-RESPONSE`.
- **Machine-to-machine by design:** "especially for AI agents." No accounts, no sessions, no credentials beyond a crypto wallet. Stateless, HTTP-native.
- **Networks:** EVM (any `eip155:*` incl. Base, Polygon, Arbitrum, Monad…), Solana, TON, Algorand, Stellar, Aptos, Hedera, Keeta, Concordium. **Token-agnostic per network**, default stablecoins (USDC on Base).
- **Transfer methods:** EIP-3009 (USDC, single off-chain signature, gasless) preferred; Permit2 fallback; SPL on Solana; etc. **Facilitator sponsors gas** — buyer signs, facilitator submits.
- **Schemes (payment models):** `exact` (pay exact amount), `upto` (pay up to a ceiling), `batch-settlement` (deposit once → off-chain vouchers per request → redeem in batches; for high-frequency micropayments).
- **Facilitator:** optional but recommended. Verifies + settles onchain on the server's behalf. Public `x402.org` facilitator is **dev/testnet only**; production needs a provider, self-hosted, or self-facilitation.
- **Lifecycle hooks (the key for you):** `onBeforeVerify`, `onAfterVerify`, `onBeforeSettle`, `onAfterSettle`, failure variants, and `onVerifiedPaymentCanceled`. Any hook can return `{ abort: true, reason }` to **reject before verify/settle**, or `{ skip: true, result }` to inject a local decision. **This is the native extension point for human approval / policy gating.**
- **MCP integration exists:** the docs ship a "MCP Server with x402" guide where an agent (Claude) calls a tool, the MCP server detects the `402`, auto-pays via the wallet, and returns data. This is *almost literally* your "wire agent comes and negotiates/pays" scenario.

---

## 2. Mapping your idea → x402

| Your concept (from the artifact) | x402 equivalent | Gap? |
|---|---|---|
| Agent (Buyer/Seller/Verifier) | x402 Client (buyer) / Server (seller) | None — direct |
| "Negotiate terms, create execution plan" (stages 5–6) | **Not in x402.** x402 only carries the final price the server declares. | **Gap — you own this.** |
| "Settle tokens in escrow, release after proof" (stage 7) | x402 `exact`/`batch-settlement` settles payment; `PAYMENT-RESPONSE` is the receipt. | Partial — x402 settles, but *release-after-proof* (HTLC/escrow) is not built in. |
| Reputation updates after verified outcome (stage 8) | Extensions: **Receipts**, **Sign-In-With-X (SIWX)**. No built-in reputation. | Partial — you own reputation (already planned as placeholder in MVP1). |
| **Payment Safety Transformer** ($50 vs $500 typo guard) | **x402 does not have this.** But `onBeforeSettle` hook is the exact place to implement it. | **Gap you close with a hook.** |
| "Human judgment before payment" | `onBeforeVerify` / `onBeforeSettle` can `abort` and ask a human. | **Native hook — perfect fit.** |
| Verifier (ProofRuntime) + ZK-TLS proof | x402 verifies *payment*, not *delivery*. Proof of delivery is your layer (MVP4). | Gap — you own this. |

**Verdict:** x402 = your **settlement + payment rail**. Negotiation, policy/safety, escrow-release, proof, and reputation remain **your** protocol on top. This is the correct decomposition, not a fork or a replacement.

---

## 3. Pros and Cons of adopting x402 — by aspect

### Aspect A — Payment transport (HTTP 402)
- **Pro:** Native web protocol; any HTTP client/server works; no proprietary SDK lock-in beyond x402's libs (TS/Python/Go). Zero account/session friction — ideal for autonomous agents.
- **Con:** `402` is unusual; some proxies/CDNs/WAFs may mishandle it. You must ensure your infra passes the three headers (`PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE`).

### Aspect B — Agent/M2M fit
- **Pro:** The docs explicitly target AI agents and ship an MCP example. Your "Hermes wire agent" maps 1:1 to an x402 client that auto-pays when policy allows.
- **Con:** Auto-pay is the *default* in the MCP demo — you must insert the policy/human gate *before* that auto-pay fires, or you inherit the exact $500 bug your artifact warns about.

### Aspect C — Facilitator (verification + settlement)
- **Pro:** Servers don't need blockchain nodes or verification logic; gas is sponsored; standardized. Production facilitators exist for Base/Solana/Polygon/Avalanche.
- **Con:** **Trust dependency.** A facilitator sees payloads and submits txns. Public `x402.org` is testnet-only. For mainnet you need a provider, self-host, or self-facilitate (more infra/ops). Adds a network hop + latency + a counterparty to vet.

### Aspect D — Networks & tokens
- **Pro:** Multi-chain (EVM + Solana + others), token-agnostic, USDC default on Base. Matches your env (you have Solana + Aptos + EVM toolchains installed).
- **Con:** Each network needs a production settlement path; "protocol support ≠ production support." Solana has a documented **duplicate-settlement race** you must defend against (use the built-in `SettlementCache`, or implement your own if self-settling).

### Aspect E — Schemes (exact / upto / batch)
- **Pro:** `exact` for one-shot; `batch-settlement` is purpose-built for high-frequency micropayments (your GPU-per-hour leasing maps well — deposit once, voucher per hour). `upto` lets the agent cap spend.
- **Con:** `batch-settlement` adds an escrow contract + redemption logic — more attack surface and more to audit.

### Aspect F — Human-approval / policy gate (your core ask)
- **Pro:** Lifecycle hooks (`onBeforeVerify`/`onBeforeSettle` → `abort`) are a **first-class, documented** extension point. You can block, prompt a human, or apply your Safety Transformer here without forking x402.
- **Con:** The hook runs **server-side** in the *resource server's* process. For *buyer-side* human approval (the agent about to spend the owner's money), the gate belongs in the **client/wallet layer** (your agent's policy engine), not x402's server hooks. So: server hooks gate the *seller's* side; your agent's policy engine gates the *buyer's* side. Both are needed.

### Aspect G — Security / custody
- **Pro:** Buyer signs off-chain (EIP-3009/Permit2/SPL); no approval tx needed for EIP-3009; facilitator is non-custodial ("does not hold funds").
- **Con:** Private keys live in the agent's environment (the MCP demo puts `EVM_PRIVATE_KEY` in env). Your artifact's vault/session-key model (limited vault, not the full wallet) is the right mitigation and is **not** provided by x402 — you implement it.

### Aspect H — Receipts / proofs / reputation
- **Pro:** `Receipts` and `SIWX` extensions give you signed payment evidence to feed reputation.
- **Con:** Reputation scoring, dispute handling, and delivery-proof (ZK-TLS) are outside x402. You already planned these as MVP4/placeholder.

---

## 4. Can we use x402 in our project? — Direct answer

**Yes, for settlement, starting at MVP3 (simulated) → MVP4 (real).** Do **not** bolt real x402 into MVP1/MVP2 (they're social/negotiation). Concretely:

- **MVP1 (done-planning):** No x402. In-memory, reputation placeholder. (Unchanged.)
- **MVP2 (negotiation):** No x402 yet. Add the negotiation engine + structured counteroffers + transcript hashes. This is the layer x402 lacks.
- **MVP3 (simulated settlement):** Introduce x402 *shapes* but with a **mock facilitator / mock chain**. Your server returns `402` + `PAYMENT-REQUIRED`; your client produces a payment payload; a fake facilitator returns "verified+settled". This lets you build the **human-approval hook** and **Safety Transformer** against the real protocol surface without real money.
- **MVP4 (real settlement):** Swap the mock facilitator for a production facilitator (or self-host) on Base (USDC) and/or Solana. Wire `batch-settlement` for GPU-hour micropayments. Add ZK-TLS delivery proof + reputation.

This is exactly the phased path your artifact describes ("Simulated settlement" then "Real settlement").

---

## 5. My recommendations

1. **Adopt x402 as the payment standard, not a custom rail.** It's credibly neutral, multi-chain, agent-native, and has the hook you need. Reinventing payment transport wastes effort and adds security risk.
2. **Keep three layers strictly separated:**
   - **Negotiation layer** (yours): intent ↔ offer ↔ counteroffer ↔ execution plan. x402-ignorant.
   - **Policy/Safety layer** (yours): vault cap, per-trade limit, anomaly check, **human-approval gate**. Runs *before* any payment payload is signed (buyer side) and as a server `onBeforeSettle` hook (seller side).
   - **Settlement layer** (x402): turns an approved execution plan + price into a signed payment and onchain settlement.
3. **Implement the Safety Transformer as BOTH a client policy check and a server hook.** Client side prevents the agent from *signing* a bad amount; server side (your facilitator-adjacent hook) prevents fulfilling if policy mismatches — defense in depth.
4. **Start on Base (USDC, EIP-3009).** Simplest gasless flow, biggest facilitator ecosystem, matches "default stablecoin" support. Add Solana later for your existing Solana tooling.
5. **Never put a raw owner private key in the agent.** Use the artifact's **vault / session-key** model: agent signs from a limited vault; the owner wallet is the custodian. x402 signs from whatever key you give it — so you give it the *vault* key, not the MetaMask key.
6. **Treat the public facilitator as testnet-only.** For MVP3 use a mock; for MVP4 pick a production facilitator or self-host, and defend the Solana duplicate-settlement race if you touch Solana.
7. **Use x402 `Receipts` + `SIWX`** as the input to your reputation service (closes the MVP1 placeholder).

---

## 6. Proof Plan — prove the fit with a runnable spike (MVP3-preview)

Goal: a minimal, **money-free** spike that proves (a) your agent can negotiate, (b) x402's 402 handshake works, and (c) a **human-approval + Safety-Transformer gate** can block/allow payment — using a mock facilitator so no chain or real funds are involved.

### P0 — Scaffold the spike (30 min)
- Folder: `packages/x402-proof/` (standalone, does not touch MVP1 server).
- Deps: `@x402/core`, `@x402/axios` (or the TS SDK), `express` (resource server), `viem` (signer), `vitest`.
- Files: `server.ts` (seller), `client.ts` (Hermes wire-agent buyer), `policy.ts` (Safety Transformer), `humanGate.ts` (approval), `tests/proof.test.ts`.

### P1 — Seller returns 402 with PAYMENT-REQUIRED (TDD)
- Test: `GET /resource` with no payment → `402` + `PAYMENT-REQUIRED` header present, decodes to `{ amount, network:"eip155:84532", scheme:"exact", payTo }`.
- Impl: use `@x402/core` `x402PaymentMiddleware` (or hand-build the header) on an Express route.
- Verify: `vitest` asserts status 402 + header decodes. Commit.

### P2 — Buyer auto-pays via x402 client (TDD)
- Test: buyer with a signer calls the resource through `x402Client`/`wrapAxiosWithPayment` → gets `200` + resource body.
- Impl: register `ExactEvmScheme` with a test signer (Base Sepolia, but we will not broadcast — see P4).
- Verify: test passes against the real handshake shape. Commit.

### P3 — Safety Transformer (buyer-side policy gate) (TDD)
- `policy.ts` exports `evaluate(requested, agent)`:
  - `vaultBalance`, `maxSingleTrade`, `dailyBudget`, `anomalyMultiplier` (mirrors MVP1 `Policy`).
  - Returns `{ allow: boolean, reason }`. Blocks if `requested > maxSingleTrade`, or `requested > 10x` normal (anomaly), or `requested > vaultBalance`.
- Test: `evaluate(500, {maxSingleTrade:50,...})` → `{allow:false, reason:"exceeds per-trade limit"}`; `evaluate(50, ...)` → allow.
- Wire into buyer: **the payment payload is only signed if `evaluate()` allows.** If blocked, buyer throws "policy rejection" instead of paying.
- Verify: test + an integration test where a $500 request is *never signed*. Commit.

### P4 — Mock facilitator (no chain, no money) (TDD)
- `mockFacilitator.ts`: implements `/verify` and `/settle` in-memory. `/verify` returns valid; `/settle` records the payment to a local ledger and returns a fake `txHash`. No `viem` broadcast, no network.
- Point the server's facilitator client at the mock.
- Test: full flow (P2) now uses mock facilitator; asserts a ledger entry exists with payer/amount. Commit.

### P5 — Human-approval gate (the "human judgment before payment" ask) (TDD)
- `humanGate.ts`: `requestApproval(plan): Promise<"approve"|"deny">`. In tests, inject a stub that returns `deny` for large amounts, `approve` for small.
- Wire: in the buyer flow, **after** `evaluate()` passes but **before** signing, call `requestApproval(executionPlan)`. If denied → no signature, no payment.
- Test: a large plan with `deny` stub → no ledger entry, response is a structured "awaiting approval / denied". A small plan with `approve` stub → ledger entry created. Commit.

### P6 — Server-side hook (defense in depth) (TDD)
- On the Express server, register `onBeforeSettle` lifecycle hook that re-checks the same `Policy` against the incoming payload amount; `abort:true` if it would exceed the seller's configured limit.
- Test: tampered oversized payload → hook aborts, `402` returned, no settlement. Commit.

### P7 — End-to-end proof script (manual, no money)
- `npm run proof`: starts mock facilitator + server, runs buyer through three scenarios and prints results:
  1. **Normal:** $8 GPU-hour plan → policy ok → human approve → paid (ledger entry).
  2. **Typo guard:** $500 requested vs $50 intent → `evaluate()` blocks → never signed.
  3. **Human override:** $200 plan → policy allows (within vault) → human **denies** → not paid.
- Expected console output demonstrates all three, proving x402 carries the payment while *your* layers own negotiation + safety + human judgment.

### P8 — Write `X402_FIT_PROOF.md` + README
- Document the spike, what it proved, what x402 covers vs what Finality owns, and the recommended MVP3→MVP4 path (Section 4). Commit.

---

## 7. Validation / "proof" criteria

The spike is a proof when **all** hold:
- [ ] A `402` + `PAYMENT-REQUIRED` is produced and correctly decoded by the client (x402 transport works).
- [ ] With a mock facilitator, an approved plan results in a verifiable ledger settlement entry (x402 verify+settle flow works, no chain needed).
- [ ] The $500-vs-$50 typo is **blocked before any signature** by `evaluate()` (Safety Transformer works).
- [ ] A policy-allowed but human-**denied** plan is **not paid** (human judgment works).
- [ ] The server `onBeforeSettle` hook independently rejects an oversized payload (defense in depth works).
- [ ] Zero real funds moved, zero mainnet broadcasts (proven safe to run).

---

## 8. Risks & open questions

- **x402 is evolving (V1→V2 migration exists).** Pin versions; the V2 header scheme (`PAYMENT-REQUIRED/SIGNATURE/RESPONSE`) is what this plan targets.
- **Facilitator trust** is the main new risk vs a fully self-built rail. Mitigate via mock (MVP3) → production provider/self-host (MVP4), and keep settlement non-custodial.
- **Buyer-side vs server-side gating:** confirm your product wants the human gate on the *agent's* side (recommended, since it's the owner's money) — that's a client/policy concern, not an x402 server hook. This plan implements both; you may keep one.
- **Solana duplicate-settlement:** only relevant if you settle on Solana; use `SettlementCache` or self-implement.
- **"Negotiation" remains yours.** x402 will not help structure counteroffers — that's MVP2 and is where most of your protocol IP lives.
- **Open question for you:** do you want x402 only for *final settlement*, or also to *signal price* during negotiation (server advertises a `PAYMENT-REQUIRED` as the "ask")? Either works; the former is simpler and recommended.

---

## 9. Decision summary

| Question | Answer |
|---|---|
| Will x402 work for us? | **Yes** — as the settlement/payment rail (MVP3 sim → MVP4 real). |
| Is something different needed? | Yes, **alongside** it: negotiation (MVP2), policy/Safety Transformer, human-approval gate, escrow-release, delivery proof, reputation. x402 does not provide these. |
| Where does human judgment fit? | Buyer-side: agent policy engine gates signing. Seller-side: `onBeforeSettle` hook. Both proven in the spike. |
| Biggest risk | Facilitator trust + auto-pay default → mitigated by mock facilitator + explicit policy gate. |
| Recommended next step | Run the P0–P8 spike (Section 6) to get a runnable, money-free proof before committing MVP3/MVP4 design. |
