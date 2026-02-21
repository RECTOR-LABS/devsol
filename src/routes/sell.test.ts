import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { sellRoutes } from './sell.js';
import { TransactionDB } from '../db/sqlite.js';
import { PricingService } from '../services/pricing.js';

describe('POST /sell', () => {
  let db: TransactionDB;
  let app: Hono;
  const pricing = new PricingService(1.05, 0.95);
  const treasuryAddress = 'SoLTreasuryDEV1111';

  beforeEach(() => {
    db = new TransactionDB(':memory:');
    app = new Hono();
    app.route('/', sellRoutes({ db, pricing, treasuryAddress }));
  });

  afterEach(() => db.close());

  it('creates a pending sell order and returns deposit info', async () => {
    const res = await app.request('/sell', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: 'SellerWallet', amount_sol: 10 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('pending');
    expect(body.deposit_address).toBe(treasuryAddress);
    expect(body.memo).toBeDefined();
    expect(body.memo).toMatch(/^devsol-/);
    expect(body.usdc_payout).toBe(9.5);
    expect(body.instructions).toContain('memo');
  });

  it('validates request body', async () => {
    const res = await app.request('/sell', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: 'SellerWallet' }),
    });
    expect(res.status).toBe(400);
  });

  it('persists sell order in database', async () => {
    const res = await app.request('/sell', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: 'SellerWallet', amount_sol: 5 }),
    });
    const body = await res.json();
    const tx = db.getById(body.transaction_id);
    expect(tx).not.toBeNull();
    expect(tx!.type).toBe('sell');
    expect(tx!.status).toBe('pending');
    expect(tx!.memo).toBe(body.memo);
    expect(tx!.sol_amount).toBe(5);
    expect(tx!.usdc_amount).toBe(4.75);
  });
});
