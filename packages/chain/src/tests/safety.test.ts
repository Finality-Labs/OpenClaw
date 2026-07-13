import { describe, it, expect } from 'vitest';
import { evaluate, type SafetyPolicy } from '../safety.js';

const base: SafetyPolicy = {
  vaultBalance: 10_000,
  maxSingleTrade: 50,
  dailyBudget: 500,
  anomalyMultiplier: 10,
  normal: 50,
  dailySpent: 0,
};

describe('safety.evaluate', () => {
  it('blocks a $500 trade over maxSingleTrade 50', () => {
    const r = evaluate(500, base);
    expect(r.allow).toBe(false);
    expect(r.reason).toMatch(/maxSingleTrade/);
  });

  it('allows a $40 trade within policy', () => {
    const r = evaluate(40, base);
    expect(r.allow).toBe(true);
    expect(r.reason).toBe('ok');
  });

  it('blocks anomaly: $1000 > 10x normal (50), when maxSingleTrade is not the limiter', () => {
    // Construct a policy where only the anomaly rule can block $1000.
    const r = evaluate(1000, {
      vaultBalance: 1_000_000,
      maxSingleTrade: 5000,
      dailyBudget: 1_000_000,
      anomalyMultiplier: 10,
      normal: 50,
      dailySpent: 0,
    });
    expect(r.allow).toBe(false);
    expect(r.reason).toMatch(/anomaly/);
  });

  it('allows exactly at maxSingleTrade', () => {
    const r = evaluate(50, base);
    expect(r.allow).toBe(true);
  });

  it('blocks when exceeding vaultBalance', () => {
    const r = evaluate(100, { ...base, vaultBalance: 80, maxSingleTrade: 1000 });
    expect(r.allow).toBe(false);
    expect(r.reason).toMatch(/vaultBalance/);
  });

  it('blocks when exceeding dailyBudget (rolling)', () => {
    // maxSingleTrade + anomaly raised high so dailyBudget is the first trigger.
    const r = evaluate(100, {
      ...base,
      maxSingleTrade: 5000,
      dailyBudget: 120,
      dailySpent: 50,
    });
    expect(r.allow).toBe(false);
    expect(r.reason).toMatch(/dailyBudget/);
  });

  it('rejects non-positive amounts', () => {
    expect(evaluate(0, base).allow).toBe(false);
    expect(evaluate(-5, base).allow).toBe(false);
  });
});
