import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TransactionDB } from '../db/sqlite.js';
import { PricingService } from '../services/pricing.js';
import { statsRoutes } from './stats.js';
import { Hono } from 'hono';

describe('GET /stats', () => {
  let db: TransactionDB;
  let app: Hono;

  beforeEach(() => {
    db = new TransactionDB(':memory:');
    const pricing = new PricingService(1.05, 0.95);
    app = new Hono();
    app.route('/', statsRoutes(db, pricing));
  });

  afterEach(() => db.close());

  it('returns platform stats with counts and rates', async () => {
    db.create({ type: 'buy', wallet: 'a', sol_amount: 1, usdc_amount: 1.05 });
    const tx = db.create({ type: 'sell', wallet: 'b', sol_amount: 2, usdc_amount: 1.90 });
    db.update(tx.id, { status: 'completed' });

    const res = await app.request('/stats');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total_trades).toBe(2);
    expect(body.completed_trades).toBe(1);
    expect(body.pending_orders).toBe(1);
    expect(body.success_rate).toBeDefined();
    expect(body.buy_rate).toBe(1.05);
    expect(body.sell_rate).toBe(0.95);
    expect(body.spread).toBeDefined();
    expect(body.network_fees).toBe('included');
  });

  it('handles zero trades without division by zero', async () => {
    const res = await app.request('/stats');
    const body = await res.json();
    expect(body.total_trades).toBe(0);
    expect(body.success_rate).toBe(0);
  });
});
