import { describe, it, expect } from 'vitest';
import { ReputationProvider, isOnChainReputationAvailable } from '../reputationProvider.js';

describe('ReputationProvider (off-chain fallback)', () => {
  it('falls back to off-chain when no live adapter is given', async () => {
    const provider = new ReputationProvider(null);
    const r = await provider.giveFeedback({
      agentId: 'agent-7',
      value: 1,
      decimals: 0,
      tag1: 'deal',
      tag2: 'paid',
      proofOfPayment: {
        fromAddress: '0xBUYER',
        toAddress: '0xSELLER',
        chainId: 48816,
        txHash: '0xsettled',
      },
    });
    expect(r.mode).toBe('offchain');
    expect(r.count).toBe(1);
    expect(r.summaryValue).toBe(1);
    expect(r.summaryValueDecimals).toBe(0);
    expect(r.txHash).toBe('0xsettled');
  });

  it('getSummary reads back the off-chain record', async () => {
    const provider = new ReputationProvider(null);
    await provider.giveFeedback({ agentId: 'agent-8', value: 3, proofOfPayment: { fromAddress: '0xa', toAddress: '0xb', chainId: 48816, txHash: '0x1' } });
    await provider.giveFeedback({ agentId: 'agent-8', value: 4, proofOfPayment: { fromAddress: '0xa', toAddress: '0xb', chainId: 48816, txHash: '0x2' } });
    const r = await provider.getSummary({ agentId: 'agent-8' });
    expect(r.mode).toBe('offchain');
    expect(r.count).toBe(2);
    expect(r.summaryValue).toBe(7);
  });

  it('isOnChainReputationAvailable is false without a live adapter', async () => {
    expect(await isOnChainReputationAvailable(null)).toBe(false);
  });

  it('returns empty off-chain summary for unknown agent', async () => {
    const provider = new ReputationProvider(null);
    const r = await provider.getSummary({ agentId: 'unknown' });
    expect(r.mode).toBe('offchain');
    expect(r.count).toBe(0);
    expect(r.summaryValue).toBe(0);
  });
});
