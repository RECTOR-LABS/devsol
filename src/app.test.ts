import { describe, it, expect } from 'vitest';
import { createApp } from './app.js';
import { PricingService } from './services/pricing.js';
import { TransactionDB } from './db/sqlite.js';
import { X402Service } from './services/x402.js';

function makeDeps() {
  const db = new TransactionDB(':memory:');
  const pricing = new PricingService(1.05, 0.95);
  return { db, pricing };
}

function makeTreasuryStub() {
  return {
    address: 'FakeAddr1111111111111111111111111111111111111',
    getBalance: async () => 100,
    sendSol: async () => 'fakeSig123',
  };
}

function makeX402() {
  return new X402Service({
    facilitator: { verify: async () => ({ valid: true }) },
    payTo: 'FakeAddr1111111111111111111111111111111111111',
    network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
  });
}

describe('DevSOL App', () => {
  it('GET /health returns ok', async () => {
    const { db, pricing } = makeDeps();
    const { app } = createApp({ pricing, db });
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    db.close();
  });

  it('returns CORS headers for allowed origin', async () => {
    const { db, pricing } = makeDeps();
    const { app } = createApp({ pricing, db });
    const res = await app.request('/health', {
      headers: { Origin: 'https://devsol.rectorspace.com' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('https://devsol.rectorspace.com');
    db.close();
  });

  it('rate limits after 60 requests from same IP', async () => {
    const { db, pricing } = makeDeps();
    const { app } = createApp({ pricing, db });

    // Fire 60 requests — all should pass
    for (let i = 0; i < 60; i++) {
      const res = await app.request('/health', {
        headers: { 'x-forwarded-for': '1.2.3.4' },
      });
      expect(res.status).toBe(200);
    }

    // 61st should be rate limited
    const limited = await app.request('/health', {
      headers: { 'x-forwarded-for': '1.2.3.4' },
    });
    expect(limited.status).toBe(429);
    const body = await limited.json();
    expect(body.error).toBe('Rate limit exceeded');

    db.close();
  });

  it('rate limits per-IP independently', async () => {
    const { db, pricing } = makeDeps();
    const { app } = createApp({ pricing, db });

    // Exhaust limit for IP A
    for (let i = 0; i < 60; i++) {
      await app.request('/health', {
        headers: { 'x-forwarded-for': '10.0.0.1' },
      });
    }
    const limitedA = await app.request('/health', {
      headers: { 'x-forwarded-for': '10.0.0.1' },
    });
    expect(limitedA.status).toBe(429);

    // IP B should still be fine
    const resB = await app.request('/health', {
      headers: { 'x-forwarded-for': '10.0.0.2' },
    });
    expect(resB.status).toBe(200);

    db.close();
  });

  it('does NOT mount buy/sell routes without treasury and x402', async () => {
    const { db, pricing } = makeDeps();
    const { app } = createApp({ pricing, db });

    const buyRes = await app.request('/buy', { method: 'POST' });
    expect(buyRes.status).toBe(404);

    const sellRes = await app.request('/sell', { method: 'POST' });
    expect(sellRes.status).toBe(404);

    db.close();
  });

  it('mounts buy/sell routes when treasury AND x402 are provided', async () => {
    const { db, pricing } = makeDeps();
    const treasury = makeTreasuryStub();
    const x402 = makeX402();
    const { app } = createApp({
      pricing,
      db,
      treasury: treasury as any,
      x402,
    });

    // Buy without payment header -> 402
    const buyRes = await app.request('/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: 'TestWa11et111XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', amount_sol: 1 }),
    });
    expect(buyRes.status).toBe(402);

    // Sell -> should create pending tx
    const sellRes = await app.request('/sell', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: 'TestWa11et111XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', amount_sol: 1 }),
    });
    expect(sellRes.status).toBe(200);
    const sellBody = await sellRes.json();
    expect(sellBody.status).toBe('pending');
    expect(sellBody.deposit_address).toBe(treasury.address);

    db.close();
  });

  it('mounts treasury routes when treasury and x402 provided', async () => {
    const { db, pricing } = makeDeps();
    const treasury = makeTreasuryStub();
    const x402 = makeX402();
    const { app } = createApp({
      pricing,
      db,
      treasury: treasury as any,
      x402,
    });

    const res = await app.request('/treasury');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.address).toBe(treasury.address);

    db.close();
  });
});
