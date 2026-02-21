import { describe, it, expect } from 'vitest';
import { createApp } from './app.js';
import { PricingService } from './services/pricing.js';
import { TransactionDB } from './db/sqlite.js';

describe('DevSOL App', () => {
  it('GET /health returns ok', async () => {
    const db = new TransactionDB(':memory:');
    const pricing = new PricingService(1.05, 0.95);
    const { app } = createApp({ pricing, db });
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    db.close();
  });
});
