/**
 * Deal settlement endpoint — POST /deals (Part 3 entry point).
 *
 * Pipeline (contract §5 deal in → settlement + reputation out):
 *   1. Validate deal shape (zod, contract §5).
 *   2. Safety Transformer: evaluate(totalUsdc, policy).
 *        - blocked → 422 (reason) + NO ledger entry + NO reputation write.
 *   3. Mock x402 settle → txHash (facilitator ledger entry).
 *   4. Record reputation feedback for BOTH buyer + seller with
 *      proofOfPayment = the mock txHash.
 *   5. Return { ok, txHash, reputation }.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { evaluate, type SafetyPolicy } from './safety.js';
import { buildPayment, facilitator } from './mockFacilitator.js';
import { reputation } from './reputation.js';
import { loadChainConfig, isLiveReady, explorerBase } from './config.js';
import type { LiveAdapter } from './liveAdapter.js';

// Live adapter is lazily created once, only when CHAIN_MODE=live is ready.
let liveAdapterPromise: Promise<LiveAdapter> | null = null;
async function getLiveAdapter(): Promise<LiveAdapter | null> {
  const cfg = loadChainConfig();
  const check = isLiveReady(cfg);
  if (!check.ready) return null;
  if (!liveAdapterPromise) {
    const { createLiveAdapter } = await import('./liveAdapter.js');
    liveAdapterPromise = createLiveAdapter(cfg);
  }
  return liveAdapterPromise;
}

const partySchema = z.object({
  agentRegistry: z.string().startsWith('eip155:'),
  agentId: z.string(),
  wallet: z.string().regex(/^0x[a-fA-F0-9]+$/),
  // Optional numeric ERC-8004 on-chain agentId (ERC-721 tokenId from register).
  // When present in live mode, real giveFeedback/getSummary target it.
  onchainAgentId: z.string().regex(/^\d+$/).optional(),
});

/** Contract §5 deal object. */
export const dealSchema = z.object({
  roomId: z.string(),
  transcriptHash: z.string(),
  buyer: partySchema,
  seller: partySchema,
  unitPrice: z.number().nonnegative(),
  qty: z.number().nonnegative(),
  terms: z.string(),
  totalUsdc: z.number().positive(),
});

export type Deal = z.infer<typeof dealSchema>;

/** Default safety policy — the $50-vs-$500 guard (spec §6).
 * maxSingleTrade caps a single trade at 50 USDC; a $500 trade trips this.
 * The hard anomaly cap is 10x normal ($50). */
export const DEFAULT_POLICY: SafetyPolicy = {
  vaultBalance: 10_000,
  maxSingleTrade: 50,
  dailyBudget: 500,
  anomalyMultiplier: 10,
  normal: 50,
  dailySpent: 0,
};

export interface DealResponse {
  ok: boolean;
  mode: 'mock' | 'live';
  txHash: string;
  explorerUrl?: string;
  reputation: {
    buyer: { agentId: string } & ReturnType<typeof reputation.getReputation>;
    seller: { agentId: string } & ReturnType<typeof reputation.getReputation>;
  };
}

export async function handleDeal(
  body: unknown,
  opts: { policy?: SafetyPolicy } = {},
): Promise<DealResponse> {
  const parsed = dealSchema.safeParse(body);
  if (!parsed.success) {
    throw Object.assign(new Error('invalid deal'), {
      statusCode: 400,
      details: parsed.error.issues,
    });
  }
  const deal = parsed.data;
  const policy = opts.policy ?? DEFAULT_POLICY;

  // 2. Safety gate.
  const verdict = evaluate(deal.totalUsdc, policy);
  if (!verdict.allow) {
    throw Object.assign(new Error(`blocked by safety: ${verdict.reason}`), {
      statusCode: 422,
      reason: verdict.reason,
    });
  }

  // 3-5: settle + record reputation. Try LIVE (on-chain) when configured and
  // ready; otherwise fall back to the MOCK facilitator + in-memory reputation.
  const live = await getLiveAdapter();

  if (live) {
    // ── LIVE on-chain settlement (real token transfer to the seller wallet) ──
    const { txHash } = await live.settle(deal.seller.wallet, deal.totalUsdc);
    const cfg = loadChainConfig();
    const explorerUrl = `${explorerBase(cfg.network)}/tx/${txHash}`;
    const proof = {
      fromAddress: deal.buyer.wallet,
      toAddress: deal.seller.wallet,
      chainId: live.chainId,
      txHash,
    };

    // On-chain reputation requires numeric ERC-8004 agentIds (register first).
    // When provided, record real feedback; else skip gracefully (settlement is
    // still real). We never let a reputation error void a completed payment.
    const buyerAgent = { agentId: deal.buyer.agentId, count: 0, summaryValue: 0, summaryValueDecimals: 0 };
    const sellerAgent = { agentId: deal.seller.agentId, count: 0, summaryValue: 0, summaryValueDecimals: 0 };
    try {
      if (deal.buyer.onchainAgentId) {
        await live.giveFeedback({
          agentId: deal.buyer.onchainAgentId, value: 1, decimals: 0,
          tag1: 'deal', tag2: 'paid', endpoint: '/deals', feedbackHash: deal.transcriptHash, proofOfPayment: proof,
        });
        Object.assign(buyerAgent, await live.getReputation(deal.buyer.onchainAgentId));
      }
      if (deal.seller.onchainAgentId) {
        await live.giveFeedback({
          agentId: deal.seller.onchainAgentId, value: 1, decimals: 0,
          tag1: 'deal', tag2: 'fulfilled', endpoint: '/deals', feedbackHash: deal.transcriptHash, proofOfPayment: proof,
        });
        Object.assign(sellerAgent, await live.getReputation(deal.seller.onchainAgentId));
      }
    } catch (e) {
      // Reputation is best-effort in live mode; payment already settled on-chain.
      console.error('[chain] live reputation write failed (settlement stands):', (e as Error).message);
    }

    return {
      ok: true, mode: 'live', txHash, explorerUrl,
      reputation: { buyer: buyerAgent, seller: sellerAgent },
    };
  }

  // ── MOCK settlement (default, keyless) ──
  const payment = buildPayment(deal.buyer.wallet, deal.seller.wallet, deal.totalUsdc);
  const verify = await facilitator.verify(payment);
  if (!verify.ok) {
    throw Object.assign(new Error(`payment verify failed: ${verify.error}`), {
      statusCode: 422,
      reason: verify.error,
    });
  }
  const { txHash } = await facilitator.settle(payment);

  // 4. Record reputation for both parties w/ proofOfPayment = mock txHash.
  const proof = {
    fromAddress: deal.buyer.wallet,
    toAddress: deal.seller.wallet,
    chainId: 84532,
    txHash,
  };
  // Buyer gets "paid" feedback; seller gets "fulfilled" feedback. Values are
  // illustrative (MVP3 reputation scoring is ours, off-chain).
  const buyerRec = reputation.recordFeedback({
    agentId: deal.buyer.agentId,
    value: 1,
    decimals: 0,
    tag1: 'deal',
    tag2: 'paid',
    endpoint: '/deals',
    feedbackHash: deal.transcriptHash,
    proofOfPayment: proof,
  });
  const sellerRec = reputation.recordFeedback({
    agentId: deal.seller.agentId,
    value: 1,
    decimals: 0,
    tag1: 'deal',
    tag2: 'fulfilled',
    endpoint: '/deals',
    feedbackHash: deal.transcriptHash,
    proofOfPayment: proof,
  });

  // 5. Response.
  return {
    ok: true,
    mode: 'mock',
    txHash,
    reputation: {
      buyer: { agentId: buyerRec.agentId, ...reputation.getReputation(buyerRec.agentId) },
      seller: { agentId: sellerRec.agentId, ...reputation.getReputation(sellerRec.agentId) },
    },
  };
}

export function registerDealsRoutes(
  app: FastifyInstance,
  opts: { policy?: SafetyPolicy } = {},
): void {
  app.post('/deals', async (request, reply) => {
    try {
      const result = await handleDeal(request.body, opts);
      return reply.code(200).send(result);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string; reason?: string };
      const status = e.statusCode ?? 500;
      return reply.code(status).send({
        ok: false,
        error: e.message,
        reason: e.reason,
      });
    }
  });

  // POST /register — register an agent on the ERC-8004 Identity Registry (live
  // mode only). Returns { txHash, agentId } where agentId is the numeric
  // ERC-721 tokenId to pass back as onchainAgentId on future deals. In mock
  // mode this returns 422 (nothing to register off-chain).
  const registerSchema = z.object({ agentURI: z.string().min(1) });
  app.post('/register', async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: 'agentURI required' });
    }
    const live = await getLiveAdapter();
    if (!live) {
      return reply.code(422).send({
        ok: false,
        error: 'registration requires CHAIN_MODE=live with a funded GOAT_PRIVATE_KEY',
      });
    }
    try {
      const { txHash, agentId } = await live.register(parsed.data.agentURI);
      const cfg = loadChainConfig();
      return reply.code(200).send({
        ok: true,
        agentId,
        txHash,
        explorerUrl: `${explorerBase(cfg.network)}/tx/${txHash}`,
      });
    } catch (err) {
      return reply.code(500).send({ ok: false, error: (err as Error).message });
    }
  });

  // GET /mode — report whether the chain service is settling live or mock.
  app.get('/mode', async () => {
    const cfg = loadChainConfig();
    const check = isLiveReady(cfg);
    return {
      mode: check.ready ? 'live' : 'mock',
      network: cfg.network,
      liveReady: check.ready,
      reason: check.ready ? undefined : check.reason,
    };
  });
}
