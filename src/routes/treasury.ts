import { Hono } from 'hono';
import type { TreasuryService } from '../services/treasury.js';

export function treasuryRoutes(treasury: TreasuryService) {
  const router = new Hono();
  router.get('/treasury', async (c) => {
    const balance = await treasury.getBalance();
    return c.json({
      address: treasury.address,
      balance_sol: balance,
      status: balance > 0 ? 'active' : 'depleted',
    });
  });
  return router;
}
