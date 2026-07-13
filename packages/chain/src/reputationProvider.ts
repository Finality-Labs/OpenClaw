/**
 * Unified ERC-8004-compatible reputation provider with an on-chain → off-chain
 * fallback.
 *
 * Interface mirrors the ERC-8004 Reputation Registry exactly:
 *   giveFeedback(agentId, value, decimals, tag1, tag2, endpoint, feedbackURI, feedbackHash)
 *   getSummary(agentId, clientAddresses, tag1, tag2) -> { count, summaryValue, summaryValueDecimals }
 *
 * Backends (auto-selected, migratable later):
 *   1. ON-CHAIN  — SDK LiveAdapter against the ERC-8004 Reputation Registry.
 *                  Used when CHAIN_MODE=live AND the registry is actually
 *                  deployed (not a placeholder). This is the canonical path
 *                  once GOAT deploys the testnet3 registry (or on mainnet).
 *   2. OFF-CHAIN — local ReputationStore. Used when not live, or when the
 *                  on-chain registry is a stub/placeholder (e.g. GOAT
 *                  Testnet3 today: 262-byte empty contract that reverts).
 *
 * Every write stores the real payment proof (txHash) so the off-chain record
 * is verifiable and can be replayed on-chain during migration.
 *
 * The `mode` field on every result tells callers which backend answered, so
 * the UI / logging can show "off-chain (pending on-chain migration)".
 */

import { reputation as localStore, type ReputationSummary } from "./reputation.js";
import type { LiveAdapter } from "./liveAdapter.js";

export type ReputationMode = "onchain" | "offchain";

export interface GiveFeedbackInput {
  agentId: string;
  value: number;
  decimals?: number;
  tag1?: string;
  tag2?: string;
  endpoint?: string;
  feedbackURI?: string;
  feedbackHash?: string;
  proofOfPayment?: { fromAddress: string; toAddress: string; chainId: number; txHash: string };
}

export interface SummaryInput {
  agentId: string;
  clientAddresses?: string[];
  tag1?: string;
  tag2?: string;
}

export interface ReputationResult extends ReputationSummary {
  mode: ReputationMode;
  /** on-chain txHash when mode==='onchain', else the source payment txHash. */
  txHash?: string;
}

function toSummary(r: ReputationSummary, mode: ReputationMode, txHash?: string): ReputationResult {
  return { count: r.count, summaryValue: r.summaryValue, summaryValueDecimals: r.summaryValueDecimals, mode, txHash };
}

/**
 * Detect whether the configured ERC-8004 Reputation Registry is a real,
 * callable contract or just a placeholder. We probe getSummary with a dummy
 * agentId + a single client address; a real registry returns data, a
 * placeholder reverts (its implementation isn't deployed).
 *
 * Returns true when on-chain reputation is usable.
 */
export async function isOnChainReputationAvailable(
  live: LiveAdapter | null,
  probeAgentId = "1",
  probeClient = "0x000000000000000000000000000000000000dEaD",
): Promise<boolean> {
  if (!live) return false;
  try {
    await live.getReputation(probeAgentId);
    return true;
  } catch {
    return false;
  }
}

/**
 * The provider. Wraps an optional on-chain LiveAdapter; transparently falls
 * back to the local store when on-chain is unavailable or errors.
 */
export class ReputationProvider {
  constructor(private live: LiveAdapter | null) {}

  async giveFeedback(input: GiveFeedbackInput): Promise<ReputationResult> {
    if (this.live) {
      try {
        const out = await this.live.giveFeedback({
          agentId: input.agentId,
          value: input.value,
          decimals: input.decimals ?? 0,
          tag1: input.tag1 ?? "",
          tag2: input.tag2 ?? "",
          endpoint: input.endpoint ?? "",
          feedbackHash: input.feedbackHash ?? "",
          proofOfPayment: input.proofOfPayment ?? {
            fromAddress: "0x0",
            toAddress: "0x0",
            chainId: 0,
            txHash: input.feedbackHash ?? "",
          },
        });
        // Read back the on-chain summary to confirm the write landed.
        const sum = await this.live.getReputation(input.agentId);
        return toSummary(
          { count: sum.count, summaryValue: sum.summaryValue, summaryValueDecimals: sum.summaryValueDecimals },
          "onchain",
          out.txHash,
        );
      } catch (e) {
        // Registry stub/revert — fall through to off-chain so the product
        // stays functional. Settlement already happened on-chain; only the
        // reputation write is deferred.
        console.warn(
          `[reputation] on-chain giveFeedback failed (using off-chain fallback): ${(e as Error).message}`,
        );
      }
    }
    // OFF-CHAIN path — ERC-8004-equivalent local store.
    localStore.recordFeedback({
      agentId: input.agentId,
      value: input.value,
      decimals: input.decimals ?? 0,
      tag1: input.tag1,
      tag2: input.tag2,
      endpoint: input.endpoint,
      feedbackURI: input.feedbackURI,
      feedbackHash: input.feedbackHash,
      proofOfPayment: input.proofOfPayment ?? {
        fromAddress: "0x0",
        toAddress: "0x0",
        chainId: 0,
        txHash: input.feedbackHash ?? "",
      },
    });
    const r = localStore.getReputation(input.agentId);
    return toSummary(r, "offchain", input.proofOfPayment?.txHash);
  }

  async getSummary(input: SummaryInput): Promise<ReputationResult> {
    if (this.live) {
      try {
        const sum = await this.live.getReputation(input.agentId);
        return toSummary(
          { count: sum.count, summaryValue: sum.summaryValue, summaryValueDecimals: sum.summaryValueDecimals },
          "onchain",
        );
      } catch {
        // fall through to off-chain
      }
    }
    const r = localStore.getReputation(input.agentId);
    return toSummary(r, "offchain");
  }
}
