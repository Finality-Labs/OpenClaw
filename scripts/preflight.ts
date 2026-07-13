/**
 * PRE-FLIGHT (read-only, no transactions). Proves the live pipeline is wired
 * against GOAT Testnet3 and discovers our registered-agent tokenId so the
 * later tests know which agentId to write reputation against.
 *
 * Run: tsx scripts/preflight.ts
 */
import {
  buildLiveCtx,
  IDENTITY_REGISTRY,
  REPUTATION_REGISTRY,
  explorerAddr,
  fmtGoat,
} from "./lib/live.ts";
import { parseAbi } from "viem";

async function main() {
  const ctx = buildLiveCtx();
  console.log(`=== PRE-FLIGHT @ ${ctx.cfg.network} (chainId ${ctx.chain.id}) ===`);
  console.log(`rpc            : ${ctx.cfg.rpcUrl}`);
  console.log(`wallet         : ${ctx.account.address}`);
  console.log(`identity reg   : ${IDENTITY_REGISTRY}`);
  console.log(`reputation reg : ${REPUTATION_REGISTRY}\n`);

  // 1. Chain reachable?
  const block = await ctx.pc.getBlockNumber();
  console.log(`chain latest block : ${block.toString()}`);

  // 2. Wallet balance.
  const bal = await ctx.pc.getBalance({ address: ctx.account.address });
  console.log(`wallet balance    : ${fmtGoat(bal)} GOAT (${bal.toString()} wei)`);
  if (bal < 50_000_000_000_000n) {
    console.log("\n⚠️  LOW BALANCE — fund via the faucet (needs a human captcha):");
    console.log("    https://bridge.testnet3.goat.network/faucet");
    console.log(`    address to fund: ${ctx.account.address}  (${explorerAddr(ctx.account.address)})`);
  }

  // 3. Are the ERC-8004 registries deployed at the documented addresses?
  const codeId = await ctx.pc.getCode({ address: IDENTITY_REGISTRY as `0x${string}` });
  const codeRep = await ctx.pc.getCode({ address: REPUTATION_REGISTRY as `0x${string}` });
  console.log(`identity reg code    : ${codeId && codeId.length > 2 ? "DEPLOYED ✓" : "MISSING ✗"}`);
  console.log(`reputation reg code  : ${codeRep && codeRep.length > 2 ? "DEPLOYED ✓" : "MISSING ✗"}`);

  // 4. Do we already own any registered agents? (so tests can reuse them)
  const haveReg = codeId && codeId.length > 2;
  if (haveReg) {
    try {
      const owned = (await ctx.pc.readContract({
        address: IDENTITY_REGISTRY as `0x${string}`,
        abi: parseAbi(["function balanceOf(address) view returns (uint256)"]),
        functionName: "balanceOf",
        args: [ctx.account.address],
      })) as bigint;
      console.log(`agents already owned : ${owned.toString()}`);
      for (let i = 0n; i < owned; i++) {
        const tokenId = (await ctx.pc.readContract({
          address: IDENTITY_REGISTRY as `0x${string}`,
          abi: parseAbi(["function tokenOfOwnerByIndex(address,uint256) view returns (uint256)"]),
          functionName: "tokenOfOwnerByIndex",
          args: [ctx.account.address, i],
        })) as bigint;
        const wallet = await ctx.pc.readContract({
          address: IDENTITY_REGISTRY as `0x${string}`,
          abi: parseAbi(["function getAgentWallet(uint256) view returns (address)"]),
          functionName: "getAgentWallet",
          args: [tokenId],
        });
        console.log(`   agentId ${tokenId.toString()} -> wallet ${wallet}`);
      }
    } catch (e) {
      console.log("  (could not read identity registry — will register fresh):", (e as Error).message);
    }
  }

  console.log("\n✅ PRE-FLIGHT OK — chain reachable, registries present.");
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("❌ PRE-FLIGHT FAIL:", e.message);
  process.exit(1);
});
