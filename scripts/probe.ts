/**
 * PROBE: read-only connectivity + balance check against GOAT Testnet3.
 * No transactions are sent. Run: tsx scripts/probe.ts
 */
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http } from "viem";
import { GOAT_NETWORKS, loadChainConfig } from "../packages/chain/src/config.ts";

const cfg = loadChainConfig();
const net = GOAT_NETWORKS[cfg.network];
const account = privateKeyToAccount(cfg.privateKey as `0x${string}`);

const chain = {
  id: net.chainId,
  name: cfg.network,
  nativeCurrency: { name: "GOAT", symbol: "GOAT", decimals: 18 },
  rpcUrls: { default: { http: [cfg.rpcUrl as string] } },
} as const;

const pc = createPublicClient({ chain, transport: http(cfg.rpcUrl) });

async function main() {
  console.log(`network=${cfg.network} chainId=${net.chainId} rpc=${cfg.rpcUrl}`);
  const block = await pc.getBlockNumber();
  console.log("latest block:", block.toString());
  const addr = account.address;
  console.log("wallet:", addr);
  const bal = await pc.getBalance({ address: addr });
  console.log("balance (wei):", bal.toString());
  console.log("balance (GOAT):", (Number(bal) / 1e18).toFixed(6));
}
main().then(() => process.exit(0)).catch((e) => { console.error("PROBE FAIL:", e.message); process.exit(1); });
