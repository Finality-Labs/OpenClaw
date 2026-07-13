/**
 * Chain service configuration — selects mock vs. live (on-chain) settlement.
 *
 * Everything on-chain is env-driven so the default (mock) path needs NO
 * credentials and tests stay keyless. Set CHAIN_MODE=live + the GOAT vars to
 * settle real transactions on GOAT Network.
 *
 *   CHAIN_MODE           mock | live         (default: mock)
 *   GOAT_NETWORK         goat-testnet | goat-mainnet (default: goat-testnet)
 *   GOAT_RPC_URL         RPC endpoint        (default: SDK's bundled RPC for the network)
 *   GOAT_PRIVATE_KEY     0x-prefixed settler/agent key (REQUIRED for live)
 *   GOAT_SETTLE_TOKEN    ERC-20 token address to transfer as payment.
 *                        Omit to settle in native gas token via transferNative.
 *   GOAT_TOKEN_DECIMALS  decimals for GOAT_SETTLE_TOKEN (default: 18; USDC=6)
 */

export type ChainMode = "mock" | "live";

export interface ChainConfig {
  mode: ChainMode;
  network: string;
  rpcUrl?: string;
  privateKey?: string;
  settleToken?: string;
  tokenDecimals: number;
}

// GOAT networks the SDK ships (chainId + default RPC). Mirrored here so we can
// resolve a chain object without importing the SDK in mock mode.
export const GOAT_NETWORKS: Record<string, { chainId: number; rpcUrl: string }> = {
  "goat-testnet": { chainId: 48816, rpcUrl: "https://rpc.testnet3.goat.network" },
  "goat-mainnet": { chainId: 2345, rpcUrl: "https://rpc.goat.network" },
};

export function loadChainConfig(env: NodeJS.ProcessEnv = process.env): ChainConfig {
  const mode = (env.CHAIN_MODE === "live" ? "live" : "mock") as ChainMode;
  const network = env.GOAT_NETWORK ?? "goat-testnet";
  const fallbackRpc = GOAT_NETWORKS[network]?.rpcUrl;
  return {
    mode,
    network,
    rpcUrl: env.GOAT_RPC_URL ?? fallbackRpc,
    privateKey: env.GOAT_PRIVATE_KEY,
    settleToken: env.GOAT_SETTLE_TOKEN,
    tokenDecimals: env.GOAT_TOKEN_DECIMALS ? Number(env.GOAT_TOKEN_DECIMALS) : 18,
  };
}

/** True when live mode has the minimum it needs to actually transact. */
export function isLiveReady(cfg: ChainConfig): { ready: boolean; reason?: string } {
  if (cfg.mode !== "live") return { ready: false, reason: "CHAIN_MODE is not 'live'" };
  if (!cfg.privateKey) return { ready: false, reason: "GOAT_PRIVATE_KEY is not set" };
  if (!/^0x[0-9a-fA-F]{64}$/.test(cfg.privateKey))
    return { ready: false, reason: "GOAT_PRIVATE_KEY must be a 0x-prefixed 32-byte hex key" };
  if (!cfg.rpcUrl) return { ready: false, reason: "GOAT_RPC_URL is not set and no default for network" };
  if (!GOAT_NETWORKS[cfg.network]) return { ready: false, reason: `unknown GOAT_NETWORK '${cfg.network}'` };
  return { ready: true };
}

export function explorerBase(network: string): string {
  return network === "goat-mainnet"
    ? "https://explorer.goat.network"
    : "https://explorer.testnet3.goat.network";
}
