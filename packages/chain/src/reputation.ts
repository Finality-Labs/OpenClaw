/**
 * Reputation via ERC-8004 (MVP3 — local stub).
 *
 * After (mock) settlement we record feedback shaped like
 * giveFeedback(agentId, value, decimals, tag1, tag2, endpoint, feedbackURI, feedbackHash).
 * For MVP3 this is a local store; a real Base `0x8004BAa1…` call is a `// TODO`
 * seam. The read shape EXACTLY mirrors ERC-8004 `getSummary`:
 *   { count, summaryValue, summaryValueDecimals }.
 *
 * The proofOfPayment stored with each feedback matches contract §6 /
 * EIP-8004 feedback file shape:
 *   { fromAddress, toAddress, chainId, txHash }
 */

export interface ProofOfPayment {
  fromAddress: string;
  toAddress: string;
  chainId: number;
  txHash: string;
}

export interface FeedbackRecord {
  agentId: string;
  value: number;
  decimals: number;
  tag1: string;
  tag2: string;
  endpoint: string;
  feedbackURI: string;
  feedbackHash: string;
  proofOfPayment: ProofOfPayment;
  ts: number;
}

export interface ReputationSummary {
  count: number;
  summaryValue: number;
  summaryValueDecimals: number;
}

export interface RecordFeedbackInput {
  agentId: string;
  value: number;
  decimals?: number;
  tag1?: string;
  tag2?: string;
  endpoint?: string;
  feedbackURI?: string;
  feedbackHash?: string;
  proofOfPayment: ProofOfPayment;
}

export class ReputationStore {
  private feedback = new Map<string, FeedbackRecord[]>();

  /** giveFeedback — record a feedback entry for an agent (local stub). */
  // TODO real ERC-8004 ReputationRegistry on Base 0x8004BAa1…
  recordFeedback(input: RecordFeedbackInput): FeedbackRecord {
    const record: FeedbackRecord = {
      agentId: input.agentId,
      value: input.value,
      decimals: input.decimals ?? 0,
      tag1: input.tag1 ?? '',
      tag2: input.tag2 ?? '',
      endpoint: input.endpoint ?? '',
      feedbackURI: input.feedbackURI ?? '',
      feedbackHash: input.feedbackHash ?? '',
      proofOfPayment: input.proofOfPayment,
      ts: Date.now(),
    };
    const list = this.feedback.get(input.agentId) ?? [];
    list.push(record);
    this.feedback.set(input.agentId, list);
    return record;
  }

  /** getSummary — ERC-8004 read shape (count, summaryValue, decimals). */
  getReputation(agentId: string): ReputationSummary {
    const list = this.feedback.get(agentId) ?? [];
    const decimals = list.length ? list[list.length - 1].decimals : 0;
    const summaryValue = list.reduce((sum, f) => sum + f.value, 0);
    return {
      count: list.length,
      summaryValue,
      summaryValueDecimals: decimals,
    };
  }

  feedbackFor(agentId: string): FeedbackRecord[] {
    return [...(this.feedback.get(agentId) ?? [])];
  }
}

/** Shared singleton reputation store (swappable in MVP4). */
export const reputation = new ReputationStore();
