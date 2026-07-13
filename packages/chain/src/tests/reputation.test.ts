import { describe, it, expect } from 'vitest';
import { ReputationStore } from '../reputation.js';

describe('reputation store (ERC-8004 getSummary shape)', () => {
  it('reflects a recorded feedback (count=1, summaryValue matches)', () => {
    const store = new ReputationStore();
    store.recordFeedback({
      agentId: '2',
      value: 1,
      decimals: 0,
      tag1: 'deal',
      tag2: 'fulfilled',
      proofOfPayment: {
        fromAddress: '0xBUYER',
        toAddress: '0xSELLER',
        chainId: 84532,
        txHash: '0xabc',
      },
    });
    const r = store.getReputation('2');
    expect(r).toEqual({ count: 1, summaryValue: 1, summaryValueDecimals: 0 });
  });

  it('returns empty summary for unknown agent', () => {
    const store = new ReputationStore();
    expect(store.getReputation('nope')).toEqual({
      count: 0,
      summaryValue: 0,
      summaryValueDecimals: 0,
    });
  });

  it('accumulates summaryValue over multiple feedbacks', () => {
    const store = new ReputationStore();
    store.recordFeedback({
      agentId: '3',
      value: 2,
      decimals: 0,
      proofOfPayment: { fromAddress: '0xa', toAddress: '0xb', chainId: 84532, txHash: '0x1' },
    });
    store.recordFeedback({
      agentId: '3',
      value: 3,
      decimals: 0,
      proofOfPayment: { fromAddress: '0xa', toAddress: '0xb', chainId: 84532, txHash: '0x2' },
    });
    const r = store.getReputation('3');
    expect(r.count).toBe(2);
    expect(r.summaryValue).toBe(5);
  });
});
