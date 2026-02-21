import { Hono } from 'hono';
import type { PricingService } from '../services/pricing.js';

export function priceRoutes(pricing: PricingService) {
  const router = new Hono();
  router.get('/price', (c) => c.json(pricing.summary()));
  return router;
}
