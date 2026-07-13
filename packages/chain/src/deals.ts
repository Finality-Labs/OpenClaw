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

const partySchema = z.object({
  agentRegistry: z.string().startsWith('eip155:'),
  agentId: z.string(),
  wallet: z.string().regex(/^0x[a-fA-F0-9]+$/),
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
  txHash: string;
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

  // 3. Mock x402 settle (NO ledger entry if this throws).
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
}
