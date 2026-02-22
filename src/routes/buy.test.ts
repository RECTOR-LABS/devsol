import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { buyRoutes } from './buy.js';
import { TransactionDB } from '../db/sqlite.js';
import { PricingService } from '../services/pricing.js';

describe('POST /buy', () => {
  let db: TransactionDB;
  let app: Hono;
  const mockTreasury = { getBalance: vi.fn(async () => 1000), address: 'TreasuryAddr', sendSol: vi.fn() };

  beforeEach(() => {
    db = new TransactionDB(':memory:');
    vi.clearAllMocks();
    const pricing = new PricingService(1.05, 0.95);
    app = new Hono();
    app.route('/', buyRoutes({ db, pricing, treasury: mockTreasury as any, payoutAddress: 'PayoutWallet' }));
  });

  afterEach(() => db.close());

  it('returns deposit instructions for valid buy', async () => {
    const res = await app.request('/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: 'BuyerWa11etXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', amount_sol: 10 }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('pending');
    expect(data.deposit_address).toBe('PayoutWallet');
    expect(data.memo).toMatch(/^devsol-/);
    expect(data.usdc_cost).toBe(10.5);
    expect(data.amount_sol).toBe(10);
    expect(data.transaction_id).toBeDefined();
    expect(data.instructions).toContain('PayoutWallet');
  });

  it('returns 400 for invalid wallet', async () => {
    const res = await app.request('/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: 'bad', amount_sol: 1 }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 503 when treasury has insufficient SOL', async () => {
    mockTreasury.getBalance.mockResolvedValueOnce(0.5);
    const res = await app.request('/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: 'BuyerWa11etXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', amount_sol: 10 }),
    });
    expect(res.status).toBe(503);
  });

  it('creates a pending buy transaction in DB', async () => {
    await app.request('/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: 'BuyerWa11etXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', amount_sol: 5 }),
    });
    const pending = db.findPendingBuys();
    expect(pending).toHaveLength(1);
    expect(pending[0].type).toBe('buy');
    expect(pending[0].sol_amount).toBe(5);
    expect(pending[0].memo).toMatch(/^devsol-/);
  });
});
