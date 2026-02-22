import { describe, it, expect, vi } from 'vitest';
import { PayoutService } from './payout.js';

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
});
