import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
      body: JSON.stringify({ wallet: 'Se11erWa11etAddressXXXXXXXXXXXXXXXXXXXXXXXX', amount_sol: 10 }),
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
      body: JSON.stringify({ wallet: 'Se11erWa11etAddressXXXXXXXXXXXXXXXXXXXXXXXX' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_INPUT');
  });

  it('persists sell order in database', async () => {
    const res = await app.request('/sell', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: 'Se11erWa11etAddressXXXXXXXXXXXXXXXXXXXXXXXX', amount_sol: 5 }),
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

  it('rejects duplicate pending sell order for same wallet + amount', async () => {
    const wallet = 'Se11erWa11etAddressXXXXXXXXXXXXXXXXXXXXXXXX';
    const res1 = await app.request('/sell', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet, amount_sol: 10 }),
    });
    expect(res1.status).toBe(200);

    const res2 = await app.request('/sell', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet, amount_sol: 10 }),
    });
    expect(res2.status).toBe(409);
    const body = await res2.json();
    expect(body.code).toBe('DUPLICATE_ORDER');
  });

  it('returns 503 when USDC reserves insufficient', async () => {
    const mockPayout = { canAffordPayout: vi.fn(async () => false) };
    const payoutApp = new Hono();
    payoutApp.route('/', sellRoutes({ db, pricing, treasuryAddress, payout: mockPayout }));

    const res = await payoutApp.request('/sell', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: 'Se11erWa11etAddressXXXXXXXXXXXXXXXXXXXXXXXX', amount_sol: 10 }),
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('INSUFFICIENT_RESERVES');
  });
});
