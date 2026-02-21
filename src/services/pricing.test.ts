import { describe, it, expect } from 'vitest';
import { PricingService } from './pricing.js';

describe('PricingService', () => {
  const pricing = new PricingService(1.05, 0.95);

  it('calculates buy cost in USDC', () => {
    expect(pricing.buyQuote(10)).toEqual({
      sol_amount: 10,
      usdc_amount: 10.5,
      rate: 1.05,
    });
  });

  it('calculates sell payout in USDC', () => {
    expect(pricing.sellQuote(10)).toEqual({
      sol_amount: 10,
      usdc_amount: 9.5,
      rate: 0.95,
    });
  });

  it('returns price summary', () => {
    const summary = pricing.summary();
    expect(summary.buy.usdc_per_sol).toBe(1.05);
    expect(summary.sell.usdc_per_sol).toBe(0.95);
    expect(summary.spread).toBeCloseTo(0.1);
  });

  it('rejects zero or negative amounts', () => {
    expect(() => pricing.buyQuote(0)).toThrow();
    expect(() => pricing.buyQuote(-5)).toThrow();
    expect(() => pricing.sellQuote(0)).toThrow();
  });

  it('rounds USDC amounts to 6 decimals (USDC precision)', () => {
    const quote = pricing.buyQuote(3.333333);
    // 3.333333 * 1.05 = 3.49999965 → rounded to 6 decimals = 3.5
    expect(quote.usdc_amount).toBe(3.5);
  });
});
