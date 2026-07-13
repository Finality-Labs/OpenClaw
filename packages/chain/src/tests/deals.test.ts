import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../app.js';
import type { FastifyInstance } from 'fastify';
import { facilitator } from '../mockFacilitator.js';
import { reputation } from '../reputation.js';

const validDeal = {
  roomId: 'room_abc',
  transcriptHash: '0xtranscript',
  buyer: {
    agentRegistry: 'eip155:84532:0x8004A818BFB912233c491871b3d84c89A494BD9e',
    agentId: '1',
    wallet: '0x1111111111111111111111111111111111111111',
  },
  seller: {
    agentRegistry: 'eip155:84532:0x8004A818BFB912233c491871b3d84c89A494BD9e',
    agentId: '2',
    wallet: '0x2222222222222222222222222222222222222222',
  },
  unitPrice: 18,
  qty: 5,
  terms: 'per-hour',
  totalUsdc: 90,
};

describe('POST /deals (integration)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    // Reset shared singletons between tests.
    // @ts-expect-error access private for test reset
    facilitator.ledger = [];
    // @ts-expect-error access private for test reset
    reputation.feedback = new Map();
    app = await buildApp();
    await app.ready();
  });

  it('settles a valid $90 deal → 200, txHash + reputation, ledger has 1 entry', async () => {
    // $90 must be within the active policy (relaxed maxSingleTrade) for this
    // "valid" case; the $50-vs-$500 guard is exercised by the blocked test.
    const relaxedApp = await buildApp({
      policy: {
        vaultBalance: 10_000,
        maxSingleTrade: 500,
        dailyBudget: 1_000,
        anomalyMultiplier: 10,
        normal: 50,
        dailySpent: 0,
      },
    });
    await relaxedApp.ready();
    const res = await relaxedApp.inject({
      method: 'POST',
      url: '/deals',
      payload: validDeal,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.txHash).toBe('string');
    expect(body.txHash.startsWith('0x')).toBe(true);
    expect(facilitator.ledgerCount()).toBe(1);
    expect(body.reputation.buyer.agentId).toBe('1');
    expect(body.reputation.seller.agentId).toBe('2');
    expect(body.reputation.seller.count).toBe(1);
    expect(body.reputation.seller.summaryValue).toBe(1);
    await relaxedApp.close();
  });

  it('rejects a $500 deal over maxSingleTrade 50 → 422, NO ledger, NO reputation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/deals',
      payload: { ...validDeal, totalUsdc: 500 },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toMatch(/maxSingleTrade/);
    // Safety blocked before settle → nothing recorded.
    expect(facilitator.ledgerCount()).toBe(0);
    expect(reputation.getReputation('1').count).toBe(0);
    expect(reputation.getReputation('2').count).toBe(0);
  });

  it('returns 400 on an invalid deal shape', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/deals',
      payload: { roomId: 'x' }, // missing required fields
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().ok).toBe(false);
  });

  it('GET /health → ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
