import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PayoutService, usdcToAtomicUnits } from './payout.js';

describe('usdcToAtomicUnits', () => {
  it('converts 1 atomic unit (0.000001)', () => {
    expect(usdcToAtomicUnits(0.000001)).toBe(1n);
  });

  it('converts max precision (99.999999)', () => {
    expect(usdcToAtomicUnits(99.999999)).toBe(99_999_999n);
  });

  it('converts 1.1 to 1100000', () => {
    expect(usdcToAtomicUnits(1.1)).toBe(1_100_000n);
  });

  it('converts whole number (10)', () => {
    expect(usdcToAtomicUnits(10)).toBe(10_000_000n);
  });

  it('converts typical payout amount (4.75)', () => {
    expect(usdcToAtomicUnits(4.75)).toBe(4_750_000n);
  });

  it('throws on negative amount', () => {
    expect(() => usdcToAtomicUnits(-1)).toThrow('USDC amount cannot be negative');
  });
});

describe('PayoutService', () => {
  // We can't call PayoutService.create() in tests without real RPC
  // So test the logic by creating a service with mocked internals
  // Strategy: spy on getUsdcBalance to control balance

  function createTestService(opts: { balance: number; maxPayout: number; minReserve: number }) {
    // Use Object.create to get a PayoutService-shaped object with mocked methods
    const service = Object.create(PayoutService.prototype) as PayoutService;
    // Override getUsdcBalance
    vi.spyOn(service, 'getUsdcBalance').mockResolvedValue(opts.balance);
    // Set private fields via any cast
    (service as any).maxPayout = opts.maxPayout;
    (service as any).minReserve = opts.minReserve;
    return service;
  }

  describe('canAffordPayout', () => {
    it('returns true when balance covers payout + reserve', async () => {
      const service = createTestService({ balance: 200, maxPayout: 100, minReserve: 50 });
      expect(await service.canAffordPayout(100)).toBe(true);
    });

    it('returns false when balance below payout + reserve', async () => {
      const service = createTestService({ balance: 100, maxPayout: 100, minReserve: 50 });
      expect(await service.canAffordPayout(80)).toBe(false);
    });

    it('returns false when payout exceeds max', async () => {
      const service = createTestService({ balance: 1000, maxPayout: 100, minReserve: 50 });
      expect(await service.canAffordPayout(150)).toBe(false);
    });

    it('returns true at exact threshold', async () => {
      // balance=150, payout=100, reserve=50 -> 150 >= 100+50 -> true
      const service = createTestService({ balance: 150, maxPayout: 100, minReserve: 50 });
      expect(await service.canAffordPayout(100)).toBe(true);
    });

    it('returns false just below threshold', async () => {
      // balance=149.99, payout=100, reserve=50 -> 149.99 < 150 -> false
      const service = createTestService({ balance: 149.99, maxPayout: 100, minReserve: 50 });
      expect(await service.canAffordPayout(100)).toBe(false);
    });
  });

  describe('sendUsdc validation', () => {
    it('throws on non-positive amount', async () => {
      const service = createTestService({ balance: 1000, maxPayout: 100, minReserve: 50 });
      await expect(service.sendUsdc('SomeAddr111111111111111111111111111111111111', 0)).rejects.toThrow('Amount must be positive');
      await expect(service.sendUsdc('SomeAddr111111111111111111111111111111111111', -5)).rejects.toThrow('Amount must be positive');
    });

    it('throws when amount exceeds max payout', async () => {
      const service = createTestService({ balance: 1000, maxPayout: 100, minReserve: 50 });
      await expect(service.sendUsdc('SomeAddr111111111111111111111111111111111111', 150)).rejects.toThrow('Payout exceeds max: 100 USDC');
    });
  });

  describe('withRetry', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('retries on network errors then succeeds', async () => {
      const service = createTestService({ balance: 1000, maxPayout: 100, minReserve: 50 });
      const withRetry = (service as any).withRetry.bind(service);

      let attempt = 0;
      const fn = vi.fn(async () => {
        attempt++;
        if (attempt <= 2) throw new Error('Connection timeout');
        return 'success';
      });

      const promise = withRetry(fn, 3);
      await vi.advanceTimersByTimeAsync(1000); // retry 1
      await vi.advanceTimersByTimeAsync(2000); // retry 2
      const result = await promise;
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('does not retry on non-retryable validation errors', async () => {
      const service = createTestService({ balance: 1000, maxPayout: 100, minReserve: 50 });
      const withRetry = (service as any).withRetry.bind(service);

      const fn = vi.fn(async () => {
        throw new Error('Amount must be positive');
      });

      await expect(withRetry(fn, 3)).rejects.toThrow('Amount must be positive');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('throws after exhausting all retries', async () => {
      const service = createTestService({ balance: 1000, maxPayout: 100, minReserve: 50 });
      const withRetry = (service as any).withRetry.bind(service);

      const fn = vi.fn(async () => {
        throw new Error('RPC node unavailable');
      });

      const promise = withRetry(fn, 3).catch((e: Error) => e);
      await vi.runAllTimersAsync();
      const err = await promise;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe('RPC node unavailable');
      expect(fn).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    });
  });
});
