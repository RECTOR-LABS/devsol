import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { treasuryRoutes } from './treasury.js';

const mockTreasury = {
  address: 'SoLTreasury1111',
  getBalance: vi.fn(async () => 6842.5),
};

describe('GET /treasury', () => {
  const app = new Hono();
  app.route('/', treasuryRoutes(mockTreasury as any));

  it('returns treasury info', async () => {
    const res = await app.request('/treasury');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.address).toBe('SoLTreasury1111');
    expect(body.balance_sol).toBe(6842.5);
    expect(body.status).toBe('active');
  });

  it('returns 503 when balance check fails', async () => {
    const failingTreasury = {
      address: 'SoLTreasury1111111111111111111111111111111111',
      getBalance: vi.fn(async () => { throw new Error('RPC timeout'); }),
    };
    const failApp = new Hono();
    failApp.route('/', treasuryRoutes(failingTreasury as any));

    const res = await failApp.request('/treasury');
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('Treasury service unavailable');
  });

  it('GET /health/detail returns service status with payout', async () => {
    const mockPayout = {
      getUsdcBalance: vi.fn(async () => 500),
      walletAddress: 'PayoutWallet111',
    };
    const detailApp = new Hono();
    detailApp.route('/', treasuryRoutes(mockTreasury as any, mockPayout as any));

    const res = await detailApp.request('/health/detail');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.treasury_sol).toBe(6842.5);
    expect(body.payout_usdc).toBe(500);
    expect(body.payout_wallet).toBe('PayoutWallet111');
  });

  it('GET /health/detail returns null payout fields without payout service', async () => {
    const res = await app.request('/health/detail');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.treasury_sol).toBe(6842.5);
    expect(body.payout_usdc).toBeNull();
    expect(body.payout_wallet).toBeNull();
    expect(body.pending_orders).toBeNull();
  });

  it('GET /health/detail includes pending_orders count', async () => {
    const mockPayout = {
      getUsdcBalance: vi.fn(async () => 500),
      walletAddress: 'PayoutWallet111',
    };
    const mockDb = {
      findPendingSells: vi.fn(() => [{}, {}]),
      findPendingBuys: vi.fn(() => [{}]),
    };
    const detailApp = new Hono();
    detailApp.route('/', treasuryRoutes(mockTreasury as any, mockPayout as any, mockDb as any));

    const res = await detailApp.request('/health/detail');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pending_orders).toBe(3);
  });
});
