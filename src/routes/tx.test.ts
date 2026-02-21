import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { txRoutes } from './tx.js';
import { TransactionDB } from '../db/sqlite.js';

describe('GET /tx/:id', () => {
  let db: TransactionDB;
  let app: Hono;

  beforeEach(() => {
    db = new TransactionDB(':memory:');
    app = new Hono();
    app.route('/', txRoutes(db));
  });

  afterEach(() => db.close());

  it('returns a transaction by id', async () => {
    const tx = db.create({ type: 'buy', wallet: 'abc', sol_amount: 10, usdc_amount: 10.5 });
    const res = await app.request(`/tx/${tx.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(tx.id);
    expect(body.type).toBe('buy');
  });

  it('returns 404 for unknown id', async () => {
    const res = await app.request('/tx/nonexistent');
    expect(res.status).toBe(404);
  });
});
