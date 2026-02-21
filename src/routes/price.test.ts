import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { priceRoutes } from './price.js';
import { PricingService } from '../services/pricing.js';

describe('GET /price', () => {
  const app = new Hono();
  const pricing = new PricingService(1.05, 0.95);
  app.route('/', priceRoutes(pricing));

  it('returns price summary', async () => {
    const res = await app.request('/price');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.buy.usdc_per_sol).toBe(1.05);
    expect(body.sell.usdc_per_sol).toBe(0.95);
    expect(body.spread).toBeCloseTo(0.1);
  });
});
