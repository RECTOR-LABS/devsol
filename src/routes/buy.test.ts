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
    resource: { url: '/buy', description: 'test', mimeType: 'application/json' },
    accepts: [{ scheme: 'exact', network: 'solana:test', asset: 'USDC', amount: '10500000', payTo: 'pay', maxTimeoutSeconds: 300, extra: {} }],
  })),
  verifyPayment: vi.fn(async () => ({ isValid: true } as { isValid: boolean; invalidReason?: string })),
  encodePaymentRequiredHeader: vi.fn(() => 'base64encodedheader'),
  settlePayment: vi.fn(async () => ({ success: true, transaction: 'tx', network: 'solana:test' })),
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
      body: JSON.stringify({ wallet: 'BuyerWa11etAddressXXXXXXXXXXXXXXXXXXXXXXXX', amount_sol: 10 }),
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
      body: JSON.stringify({ wallet: 'BuyerWa11etAddressXXXXXXXXXXXXXXXXXXXXXXXX' }),
    });
    expect(res.status).toBe(400);
  });

  it('processes buy with valid payment', async () => {
    const res = await app.request('/buy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'payment-signature': 'valid-payment-proof',
      },
      body: JSON.stringify({ wallet: 'BuyerWa11etAddressXXXXXXXXXXXXXXXXXXXXXXXX', amount_sol: 10 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe('buy');
    expect(body.sol_amount).toBe(10);
    expect(body.status).toBe('completed');
    expect(body.devnet_tx).toBe('devnet_sig_123');
    expect(mockTreasury.sendSol).toHaveBeenCalledWith('BuyerWa11etAddressXXXXXXXXXXXXXXXXXXXXXXXX', 10);
  });

  it('returns 402 for invalid payment', async () => {
    mockX402.verifyPayment.mockResolvedValueOnce({ isValid: false, invalidReason: 'bad proof' });
    const res = await app.request('/buy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'payment-signature': 'invalid-proof',
      },
      body: JSON.stringify({ wallet: 'BuyerWa11etAddressXXXXXXXXXXXXXXXXXXXXXXXX', amount_sol: 10 }),
    });
    expect(res.status).toBe(402);
  });

  it('returns 503 when treasury has insufficient SOL', async () => {
    mockTreasury.getBalance.mockResolvedValueOnce(0);
    const res = await app.request('/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: 'BuyerWa11etAddressXXXXXXXXXXXXXXXXXXXXXXXX', amount_sol: 10 }),
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('INSUFFICIENT_RESERVES');
  });

  it('returns 402 with payment-required header', async () => {
    mockTreasury.getBalance.mockResolvedValueOnce(100);
    const res = await app.request('/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: 'BuyerWa11etAddressXXXXXXXXXXXXXXXXXXXXXXXX', amount_sol: 10 }),
    });
    expect(res.status).toBe(402);
    const prHeader = res.headers.get('payment-required');
    expect(prHeader).toBe('base64encodedheader');
  });

  it('reads payment-signature header (not X-PAYMENT)', async () => {
    mockTreasury.getBalance.mockResolvedValueOnce(100);
    const res = await app.request('/buy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'payment-signature': 'valid-payment-proof',
      },
      body: JSON.stringify({ wallet: 'BuyerWa11etAddressXXXXXXXXXXXXXXXXXXXXXXXX', amount_sol: 10 }),
    });
    expect(res.status).toBe(200);
  });

  it('includes code field in validation error response', async () => {
    const res = await app.request('/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: 'BuyerWa11etAddressXXXXXXXXXXXXXXXXXXXXXXXX' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_REQUEST');
  });

  it('fires settlement async after successful buy', async () => {
    const res = await app.request('/buy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'payment-signature': 'valid-payment-proof',
      },
      body: JSON.stringify({ wallet: 'BuyerWa11etAddressXXXXXXXXXXXXXXXXXXXXXXXX', amount_sol: 10 }),
    });
    expect(res.status).toBe(200);
    // settlePayment is fire-and-forget, but it should have been called
    await vi.waitFor(() => {
      expect(mockX402.settlePayment).toHaveBeenCalledWith('valid-payment-proof', 10.5);
    });
  });
});
