/**
 * Shared live-test plumbing for GOAT Network (Testnet3) on-chain tests.
 *
 * Builds a ViemWalletProvider (SDK) + a viem PublicClient so we can BOTH
 * sign/send real txs (register / settle / giveFeedback) AND read receipts +
 * query the ERC-8004 registries directly.
 *
 * Nothing here is secret: the private key is read from process.env
 * (loaded from the gitignored .env), never logged.
 */
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, type Chain, parseAbi, decodeEventLog } from "viem";
import { ViemWalletProvider } from "@goatnetwork/agentkit/core";
import {
  erc8004RegisterAgentAction,
  erc8004GiveFeedbackAction,
  erc8004GetReputationAction,
} from "@goatnetwork/agentkit/plugins";
import { loadChainConfig, GOAT_NETWORKS } from "../../packages/chain/src/config.ts";

export const IDENTITY_REGISTRY = "0x556089008Fc0a60cD09390Eca93477ca254A5522";
export const REPUTATION_REGISTRY = "0xd9140951d8aE6E5F625a02F5908535e16e3af964";

export const EXPLORER = "https://explorer.testnet3.goat.network";

// Minimal ABIs (from docs.goat.network/build/erc-8004) — enough to read +
// parse receipts without depending on a full artifact. Parsed into viem
// Abi fragments so readContract/decodeEventLog work.
export const IDENTITY_ABI = parseAbi([
  "function register(string agentURI) returns (uint256 agentId)",
  "function balanceOf(address owner) view returns (uint256)",
  "function ownerOf(uint256 agentId) view returns (address)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function getAgentWallet(uint256 agentId) view returns (address)",
  "event AgentRegistered(uint256 indexed agentId, address indexed owner, string agentURI)",
]);

export const REPUTATION_ABI = parseAbi([
  "function giveFeedback(uint256 agentId, uint256 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)",
  "function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint256 count, uint256 summaryValue, uint8 summaryValueDecimals)",
  "event FeedbackGiven(uint256 indexed agentId, address indexed client, uint256 feedbackIndex)",
]);

export interface LiveCtx {
  cfg: ReturnType<typeof loadChainConfig>;
  account: ReturnType<typeof privateKeyToAccount>;
  chain: Chain;
  wallet: ViemWalletProvider;
  pc: ReturnType<typeof createPublicClient>;
  register: ReturnType<typeof erc8004RegisterAgentAction>;
  giveFeedback: ReturnType<typeof erc8004GiveFeedbackAction>;
  getReputation: ReturnType<typeof erc8004GetReputationAction>;
}

export function buildLiveCtx(): LiveCtx {
  const cfg = loadChainConfig();
  if (cfg.mode !== "live" || !cfg.privateKey || !cfg.rpcUrl)
    throw new Error("CHAIN_MODE=live + GOAT_PRIVATE_KEY + GOAT_RPC_URL required (load .env)");

  const net = GOAT_NETWORKS[cfg.network];
  const account = privateKeyToAccount(cfg.privateKey as `0x${string}`);
  const chain = {
    id: net.chainId,
    name: cfg.network,
    nativeCurrency: { name: "GOAT", symbol: "GOAT", decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl as string] } },
  } as const;

  const wallet = new ViemWalletProvider(account, chain, http(cfg.rpcUrl), cfg.network);
  const pc = createPublicClient({ chain, transport: http(cfg.rpcUrl) });

  return {
    cfg,
    account,
    chain,
    wallet,
    pc,
    register: erc8004RegisterAgentAction(wallet as any),
    giveFeedback: erc8004GiveFeedbackAction(wallet as any),
    getReputation: erc8004GetReputationAction(wallet as any),
  };
}

export function explorerTx(hash: string): string {
  return `${EXPLORER}/tx/${hash}`;
}
export function explorerAddr(addr: string): string {
  return `${EXPLORER}/address/${addr}`;
}

/** Format GOAT base units (wei) to a human string. */
export function fmtGoat(wei: bigint): string {
  return (Number(wei) / 1e18).toFixed(8);
}
