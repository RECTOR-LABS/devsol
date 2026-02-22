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
    expect(body.facilitator_reachable).toBeNull();
  });

  it('GET /health/detail returns facilitator_reachable: true when facilitator responds', async () => {
    const mockFacilitator = {
      getSupported: vi.fn(async () => ({ kinds: [], extensions: [] })),
    };
    const facApp = new Hono();
    facApp.route('/', treasuryRoutes(mockTreasury as any, undefined, mockFacilitator));

    const res = await facApp.request('/health/detail');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.facilitator_reachable).toBe(true);
    expect(mockFacilitator.getSupported).toHaveBeenCalled();
  });

  it('GET /health/detail returns facilitator_reachable: false when facilitator throws', async () => {
    const mockFacilitator = {
      getSupported: vi.fn(async () => { throw new Error('Connection refused'); }),
    };
    const facApp = new Hono();
    facApp.route('/', treasuryRoutes(mockTreasury as any, undefined, mockFacilitator));

    const res = await facApp.request('/health/detail');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.facilitator_reachable).toBe(false);
  });
});
