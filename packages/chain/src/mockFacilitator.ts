/**
 * Mock x402 Facilitator (MVP3).
 *
 * In-memory /verify + /settle that records to a local ledger and returns a
 * fake txHash. NO chain, NO real funds. This is the ONLY settlement path in
 * MVP3.
 *
 * The shape mirrors the real x402 facilitator (Base USDC EIP-3009) so that a
 * real implementation can be swapped in at MVP4 behind the `// TODO real x402`
 * seams below without touching callers.
 */

import { keccak256, toHex } from 'viem';

export const MOCK_CHAIN_ID = 84532; // Base Sepolia (informative for the mock)

export interface PaymentAuthorization {
  from: string; // payer (buyer wallet)
  to: string; // payee (seller wallet)
  value: number; // USDC amount
  validAfter: number;
  validBefore: number;
  nonce: string;
}

export interface PaymentPayload {
  /** EIP-712-ish struct describing the payment. */
  x402Version: 1;
  scheme: 'exact';
  network: 'base-sepolia';
  payload: {
    signature: string; // fake signed EIP-712 signature
    authorization: PaymentAuthorization;
  };
}

export interface LedgerEntry {
  payer: string;
  payee: string;
  amount: number;
  txHash: string;
  chainId: number;
  ts: number;
}

export interface SettleResult {
  txHash: string;
}

export interface VerifyResult {
  ok: boolean;
  error?: string;
}

/**
 * Build an EIP-712-style payment payload (the payer flow).
 * The signature is a deterministic mock derived from the authorization struct.
 */
export function buildPayment(
  payer: string,
  payee: string,
  amount: number,
): PaymentPayload {
  const now = Date.now();
  const authorization: PaymentAuthorization = {
    from: payer,
    to: payee,
    value: amount,
    validAfter: now - 60_000,
    validBefore: now + 5 * 60_000,
    nonce: `0x${Math.abs(now).toString(16).padStart(8, '0')}`,
  };
  // Mock signature: keccak of the serialized authorization (NOT a real sign).
  // TODO real x402: replace with payer's actual EIP-712 signature.
  const signature = keccak256(toHex(JSON.stringify(authorization)));
  return {
    x402Version: 1,
    scheme: 'exact',
    network: 'base-sepolia',
    payload: { signature, authorization },
  };
}

export class MockFacilitator {
  private ledger: LedgerEntry[] = [];

  /** /verify — confirm the payment payload is internally consistent. */
  async verify(payment: PaymentPayload): Promise<VerifyResult> {
    const { authorization } = payment.payload;
    if (!authorization) return { ok: false, error: 'missing authorization' };
    if (!/^0x[a-fA-F0-9]+$/.test(authorization.from))
      return { ok: false, error: 'invalid payer address' };
    if (!/^0x[a-fA-F0-9]+$/.test(authorization.to))
      return { ok: false, error: 'invalid payee address' };
    if (!(authorization.value > 0))
      return { ok: false, error: 'amount must be positive' };
    if (authorization.validBefore <= Date.now())
      return { ok: false, error: 'authorization expired' };
    return { ok: true };
  }

  /** /settle — record the ledger entry and return a fake txHash. */
  async settle(payment: PaymentPayload): Promise<SettleResult> {
    const { authorization } = payment.payload;
    // TODO real x402: submit EIP-3009 transferWithAuthorization to Base USDC
    // and return the real transaction hash instead of a deterministic mock.
    const txHash = keccak256(
      toHex(
        JSON.stringify({
          ...authorization,
          settledAt: Date.now(),
        }),
      ),
    );
    this.ledger.push({
      payer: authorization.from,
      payee: authorization.to,
      amount: authorization.value,
      txHash,
      chainId: MOCK_CHAIN_ID,
      ts: Date.now(),
    });
    return { txHash };
  }

  getLedger(): LedgerEntry[] {
    return [...this.ledger];
  }

  ledgerCount(): number {
    return this.ledger.length;
  }
}

/** Shared singleton facilitator for the service (swappable in MVP4). */
export const facilitator = new MockFacilitator();
