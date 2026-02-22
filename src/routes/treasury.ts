import { Hono } from 'hono';
import type { TreasuryService } from '../services/treasury.js';

export function treasuryRoutes(treasury: TreasuryService, payout?: { getUsdcBalance(): Promise<number>; walletAddress: string }) {
  const router = new Hono();
  router.get('/treasury', async (c) => {
    try {
      const balance = await treasury.getBalance();
      return c.json({
        address: treasury.address,
        balance_sol: balance,
        status: balance > 0 ? 'active' : 'depleted',
      });
    } catch {
      return c.json({ error: 'Treasury service unavailable' }, 503);
    }
  });
  router.get('/health/detail', async (c) => {
    try {
      const treasurySol = await treasury.getBalance();
      const payoutUsdc = payout ? await payout.getUsdcBalance() : null;
      return c.json({
        treasury_sol: treasurySol,
        payout_usdc: payoutUsdc,
        payout_wallet: payout?.walletAddress ?? null,
      });
    } catch {
      return c.json({ error: 'Health check failed' }, 503);
    }
  });
  return router;
}
