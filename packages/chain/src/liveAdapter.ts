/**
 * Live on-chain adapter for GOAT Network (x402 settlement + ERC-8004 reputation).
 *
 * This is the real counterpart to mockFacilitator.ts + reputation.ts. It is
 * LAZY-LOADED (dynamic import) only when CHAIN_MODE=live, so the default mock
 * path never pulls in @goatnetwork/agentkit / viem signing and stays keyless.
 *
 * Settlement: a real token transfer from the settler wallet to the seller
 *   wallet (ERC-20 GOAT_SETTLE_TOKEN if set, else native gas token). Returns
 *   the real txHash. (Note: this is a custodial settle by the server's settler
 *   key — the simplest live model. Per-agent EIP-712 x402 signing is a
 *   follow-up; the x402 payer actions are available in the SDK for that.)
 *
 * Reputation: real ERC-8004 giveFeedback / getSummary via the SDK's erc8004
 *   actions against the registries for the configured network.
 */
import { parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { ChainConfig } from "./config.js";
import { GOAT_NETWORKS } from "./config.js";
import type { ProofOfPayment, ReputationSummary } from "./reputation.js";

export interface LiveAdapter {
  chainId: number;
  settlerAddress: string;
  settle(sellerWallet: string, amountUsd: number): Promise<{ txHash: string }>;
  giveFeedback(input: {
    agentId: string;
    value: number;
    decimals: number;
    tag1: string;
    tag2: string;
    endpoint: string;
    feedbackHash: string;
    proofOfPayment: ProofOfPayment;
  }): Promise<{ txHash: string }>;
  getReputation(agentId: string): Promise<ReputationSummary>;
}

/**
 * Build the live adapter. Throws if the SDK/keys aren't usable — callers should
 * only invoke this after isLiveReady() passes.
 */
export async function createLiveAdapter(cfg: ChainConfig): Promise<LiveAdapter> {
  // Dynamic imports: keep these out of the mock path entirely.
  const { ViemWalletProvider } = await import("@goatnetwork/agentkit/core");
  const {
    erc8004GiveFeedbackAction,
    erc8004GetReputationAction,
  } = await import("@goatnetwork/agentkit/plugins");

  const net = GOAT_NETWORKS[cfg.network];
  const account = privateKeyToAccount(cfg.privateKey as `0x${string}`);

  // Minimal viem Chain object for GOAT (the SDK accepts a Chain + Transport).
  const chain = {
    id: net.chainId,
    name: cfg.network,
    nativeCurrency: { name: "GOAT", symbol: "GOAT", decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl as string] } },
  } as const;

  const { http } = await import("viem");
  const wallet = new ViemWalletProvider(account, chain as any, http(cfg.rpcUrl), cfg.network);

  const ctx = () => ({ traceId: `finality-${Date.now()}`, network: cfg.network, now: Date.now() });

  const giveFeedback = erc8004GiveFeedbackAction(wallet as any);
  const getRep = erc8004GetReputationAction(wallet as any);

  return {
    chainId: net.chainId,
    settlerAddress: account.address,

    async settle(sellerWallet, amountUsd) {
      // ERC-20 transfer if a token is configured, else native.
      if (cfg.settleToken) {
        const amount = parseUnits(amountUsd.toString(), cfg.tokenDecimals).toString();
        return wallet.transferErc20(cfg.settleToken, sellerWallet, amount);
      }
      const wei = parseUnits(amountUsd.toString(), 18).toString();
      return wallet.transferNative(sellerWallet, wei);
    },

    async giveFeedback(input) {
      const out = await giveFeedback.execute(ctx(), {
        agentId: input.agentId,
        value: input.value,
        valueDecimals: input.decimals,
        tag1: input.tag1,
        tag2: input.tag2,
        endpoint: input.endpoint,
        feedbackURI: "",
        feedbackHash: input.feedbackHash,
      });
      return { txHash: out.txHash };
    },

    async getReputation(agentId) {
      const out = await getRep.execute(ctx(), {
        agentId,
        clientAddresses: [],
        tag1: "",
        tag2: "",
      });
      return {
        count: Number(out.count),
        summaryValue: Number(out.summaryValue),
        summaryValueDecimals: out.summaryValueDecimals,
      };
    },
  };
}
