/**
 * Safety Transformer — server-side gate for every payment.
 *
 * Contract §6: every payment is gated by policy (max single trade, vault
 * balance, anomaly multiplier). Exposed as a pure function so it is trivially
 * unit-testable and has NO side effects.
 */

export interface SafetyPolicy {
  /** Total funds the vault is allowed to spend from. */
  vaultBalance: number;
  /** Hard cap on a single trade (USDC). */
  maxSingleTrade: number;
  /** Maximum USDC that may leave the vault in a rolling day. */
  dailyBudget: number;
  /** Block a trade if it exceeds anomalyMultiplier x normal pattern. */
  anomalyMultiplier: number;
  /** Typical trade size (USDC). Defaults to 50. Used for anomaly detection. */
  normal?: number;
  /** USDC already spent in the current rolling day. Defaults to 0. */
  dailySpent?: number;
}

export interface SafetyResult {
  allow: boolean;
  reason: string;
}

const DEFAULT_NORMAL = 50;

/**
 * Evaluate a single trade amount (USDC) against the safety policy.
 * Returns { allow:false, reason } on the FIRST rule that blocks.
 */
export function evaluate(amount: number, policy: SafetyPolicy): SafetyResult {
  const normal = policy.normal ?? DEFAULT_NORMAL;
  const dailySpent = policy.dailySpent ?? 0;

  if (!(amount > 0) || Number.isNaN(amount)) {
    return { allow: false, reason: 'amount must be a positive number' };
  }

  if (amount > policy.maxSingleTrade) {
    return {
      allow: false,
      reason: `exceeds maxSingleTrade (${amount} > ${policy.maxSingleTrade})`,
    };
  }

  if (amount > policy.vaultBalance) {
    return {
      allow: false,
      reason: `exceeds vaultBalance (${amount} > ${policy.vaultBalance})`,
    };
  }

  if (dailySpent + amount > policy.dailyBudget) {
    return {
      allow: false,
      reason: `exceeds dailyBudget (${dailySpent} + ${amount} > ${policy.dailyBudget})`,
    };
  }

  if (amount > policy.anomalyMultiplier * normal) {
    return {
      allow: false,
      reason: `anomaly: amount ${amount} exceeds ${policy.anomalyMultiplier}x normal pattern (${policy.anomalyMultiplier * normal})`,
    };
  }

  return { allow: true, reason: 'ok' };
}
