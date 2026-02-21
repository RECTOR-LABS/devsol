import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { buyRoutes } from './buy.js';
import { TransactionDB } from '../db/sqlite.js';
import { PricingService } from '../services/pricing.js';

const mockTreasury = {
  address: 'TreasuryAddr',
  sendSol: vi.fn(async () => 'devnet_sig_123'),
  getBalance: vi.fn(async () => 5000),
};

const mockX402 = {
  createPaymentRequired: vi.fn(() => ({
    x402Version: 2,
    accepts: [{ scheme: 'exact', price: '$10.5', network: 'solana:test', payTo: 'pay' }],
    description: 'Buy 10 SOL',
  })),
  verifyPayment: vi.fn(async () => ({ valid: true })),
};

describe('POST /buy', () => {
  let db: TransactionDB;
  let app: Hono;
  const pricing = new PricingService(1.05, 0.95);

  beforeEach(() => {
    db = new TransactionDB(':memory:');
    app = new Hono();
    app.route('/', buyRoutes({ db, pricing, treasury: mockTreasury as any, x402: mockX402 as any }));
    vi.clearAllMocks();
  });

  afterEach(() => db.close());

  it('returns 402 when no payment header', async () => {
    const res = await app.request('/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: 'BuyerWallet', amount_sol: 10 }),
    });
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.x402Version).toBe(2);
    expect(mockX402.createPaymentRequired).toHaveBeenCalledWith(10.5, expect.any(String));
  });

  it('validates request body', async () => {
    const res = await app.request('/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: 'BuyerWallet' }),
    });
    expect(res.status).toBe(400);
  });

  it('processes buy with valid payment', async () => {
    const res = await app.request('/buy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-PAYMENT': 'valid-payment-proof',
      },
      body: JSON.stringify({ wallet: 'BuyerWallet', amount_sol: 10 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe('buy');
    expect(body.sol_amount).toBe(10);
    expect(body.status).toBe('completed');
    expect(body.devnet_tx).toBe('devnet_sig_123');
    expect(mockTreasury.sendSol).toHaveBeenCalledWith('BuyerWallet', 10);
  });

  it('returns 402 for invalid payment', async () => {
    mockX402.verifyPayment.mockResolvedValueOnce({ valid: false, reason: 'bad proof' });
    const res = await app.request('/buy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-PAYMENT': 'invalid-proof',
      },
      body: JSON.stringify({ wallet: 'BuyerWallet', amount_sol: 10 }),
    });
    expect(res.status).toBe(402);
  });
});
