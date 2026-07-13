/**
 * LIVE ON-CHAIN TEST — GOAT Network (Testnet3).
 *
 * Covers every live use case in one script:
 *   A. ERC-8004 IDENTITY REGISTRY  -> register an agent (real tx), parse the
 *      minted agentId (ERC-721 tokenId) from the receipt logs.
 *   B. x402 ON-CHAIN SETTLEMENT     -> transferNative from buyer wallet to the
 *      registered agent's wallet (real tx, real txHash = the payment proof).
 *   C. ERC-8004-COMPATIBLE REPUTATION -> giveFeedback + getSummary via the
 *      ReputationProvider (transparent on-chain→off-chain fallback, with the
 *      real settlement txHash kept as the payment proof).
 *
 * Requires: CHAIN_MODE=live, GOAT_PRIVATE_KEY, GOAT_RPC_URL in .env, AND the
 * wallet funded via the faucet (https://bridge.testnet3.goat.network/faucet).
 *
 * SAFETY: totals are tiny (0.0001 GOAT). Nothing destructive.
 * Run: tsx scripts/live-test.ts
 */
import {
  buildLiveCtx,
  IDENTITY_REGISTRY,
  IDENTITY_ABI,
  explorerTx,
  fmtGoat,
} from "./lib/live.ts";
import { decodeEventLog } from "viem";
import { appendPayment, appendReputation } from "./lib/data.ts";

const SETTLE_WEI = 100_000_000_000_000n; // 0.0001 GOAT, trivial testnet amount

async function getAgentIdFromReceipt(ctx: ReturnType<typeof buildLiveCtx>, txHash: string): Promise<bigint> {
  const rcpt = await ctx.pc.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
  for (const log of rcpt.logs) {
    if (log.address.toLowerCase() !== IDENTITY_REGISTRY.toLowerCase()) continue;
    // Prefer the ERC-721 mint Transfer (from = 0x00..0, topic[3] = tokenId).
    if (log.topics[0] === "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
        && log.topics[1] === "0x0000000000000000000000000000000000000000000000000000000000000000") {
      return BigInt(log.topics[3] as `0x${string}`);
    }
    // Fallback: decode the AgentRegistered event.
    try {
      const parsed = decodeEventLog({ abi: IDENTITY_ABI, data: log.data as `0x${string}`, topics: log.topics as any });
      if (parsed.eventName === "AgentRegistered") return (parsed.args as any).agentId as bigint;
    } catch { /* not this event */ }
  }
  throw new Error("AgentRegistered/mint event not found in receipt");
}

async function main() {
  const ctx = buildLiveCtx();
  console.log(`\n=== LIVE TEST @ ${ctx.cfg.network} (chainId ${ctx.chain.id}) ===`);
  console.log(`wallet: ${ctx.account.address}\n`);

  const startBal = await ctx.pc.getBalance({ address: ctx.account.address });
  if (startBal < SETTLE_WEI * 3n) {
    console.log(`⚠️  balance ${fmtGoat(startBal)} GOAT may be too low — fund the faucet first.`);
  }

  // ── A. ERC-8004 IDENTITY REGISTRY: register a new agent ──
  const agentURI = `ipfs://finality-test/${Date.now()}`;
  console.log(`A. Registering agent in Identity Registry (agentURI=${agentURI}) ...`);
  const reg = await ctx.register.execute(
    { traceId: `finality-${Date.now()}`, network: ctx.cfg.network, now: Date.now() },
    { agentURI },
  );
  console.log(`   txHash: ${reg.txHash}`);
  console.log(`   ${explorerTx(reg.txHash)}`);
  const agentId = await getAgentIdFromReceipt(ctx, reg.txHash);
  console.log(`   ✅ registered agentId (ERC-721 tokenId) = ${agentId.toString()}\n`);

  // Bind the agent's wallet to our settler address (so it can receive + act).
  // NOTE: setAgentWallet needs an EIP-712 signature from the *current* wallet
  // authorizing itself; for a self-owned agent we just read the bound wallet.
  const boundWallet = await ctx.pc.readContract({
    address: IDENTITY_REGISTRY as `0x${string}`,
    abi: IDENTITY_ABI,
    functionName: "getAgentWallet",
    args: [agentId],
  });
  console.log(`   agent wallet binding: ${boundWallet}`);

  // ── B. x402 ON-CHAIN SETTLEMENT: native transfer buyer->agent wallet ──
  // In production the agent wallet would be the seller; here the agent is
  // registered to the same key, so we settle to a real recipient address.
  const seller = ctx.account.address; // pay to our own controlled address
  console.log(`B. On-chain settlement (x402 leg): transfer ${fmtGoat(SETTLE_WEI)} GOAT -> ${seller}`);
  const settle = await ctx.wallet.transferNative(seller, SETTLE_WEI.toString());
  console.log(`   txHash: ${settle.txHash}`);
  console.log(`   ${explorerTx(settle.txHash)}`);
  await ctx.pc.waitForTransactionReceipt({ hash: settle.txHash as `0x${string}` });
  console.log(`   ✅ settlement confirmed on-chain\n`);

  // Persist the real settlement as a dashboard payment record (proof = txHash).
  await appendPayment({
    agentId: agentId.toString(),
    txHash: settle.txHash,
    amountGoat: fmtGoat(SETTLE_WEI),
    from: ctx.account.address,
    to: seller,
    ts: Date.now(),
    explorerUrl: explorerTx(settle.txHash),
  });

  const proof = {
    fromAddress: ctx.account.address,
    toAddress: seller,
    chainId: ctx.chain.id,
    txHash: settle.txHash,
  };

  // ── C. ERC-8004-COMPATIBLE REPUTATION (on-chain→off-chain fallback) ──
  // The provider mirrors the ERC-8004 giveFeedback/getSummary interface. On
  // GOAT Testnet3 the Reputation Registry contract is a placeholder (262
  // bytes, reverts), so the provider transparently falls back to the
  // off-chain store — keeping the product functional and the interface
  // migration-ready. The real settlement txHash is stored as the proof.
  console.log(`C. Reputation (ERC-8004-compatible provider, agentId=${agentId}):`);
  const { ReputationProvider } = await import("../packages/chain/src/reputationProvider.ts");
  const rep = new ReputationProvider(null);
  const fbRes = await rep.giveFeedback({
    agentId: agentId.toString(),
    value: 1,
    decimals: 0,
    tag1: "deal",
    tag2: "paid",
    endpoint: "/deals",
    feedbackHash: settle.txHash,
    proofOfPayment: proof,
  });
  const sumRes = await rep.getSummary({ agentId: agentId.toString() });
  console.log(`   mode           : ${fbRes.mode}`);
  console.log(`   feedback count : ${fbRes.count}`);
  console.log(`   summaryValue   : ${fbRes.summaryValue}`);
  console.log(`   payment proof  : ${fbRes.txHash} (real on-chain settle tx)\n`);
  if (fbRes.mode === "offchain") {
    console.log(`   ↳ Off-chain fallback active (testnet3 Reputation Registry is a placeholder).`);
    console.log(`      Interface is ERC-8004-equivalent; will go on-chain automatically once deployed.\n`);
  }

  // Persist the rating as a dashboard record (proof = real settle txHash).
  await appendReputation({
    agentId: agentId.toString(),
    value: fbRes.summaryValue,
    decimals: fbRes.summaryValueDecimals,
    tag1: "deal",
    tag2: "paid",
    endpoint: "/deals",
    feedbackHash: settle.txHash,
    proofTxHash: settle.txHash,
    ts: Date.now(),
  });

  console.log("=== LIVE TEST RESULT ===");
  console.log(JSON.stringify({
    agentId: agentId.toString(),
    registerTx: reg.txHash,
    settleTx: settle.txHash,
    reputation: {
      mode: sumRes.mode,
      count: sumRes.count,
      summaryValue: sumRes.summaryValue,
      summaryValueDecimals: sumRes.summaryValueDecimals,
      paymentProof: sumRes.txHash,
    },
  }, null, 2));
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("❌ LIVE TEST FAIL:", e.message);
  process.exit(1);
});
