import { Hono } from 'hono';
import type { TreasuryService } from '../services/treasury.js';

interface FacilitatorHealth {
  getSupported(): Promise<any>;
}

export function treasuryRoutes(
  treasury: TreasuryService,
  payout?: { getUsdcBalance(): Promise<number>; walletAddress: string },
  facilitator?: FacilitatorHealth,
) {
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

      let facilitatorReachable: boolean | null = null;
      if (facilitator) {
        try {
          await facilitator.getSupported();
          facilitatorReachable = true;
        } catch {
          facilitatorReachable = false;
        }
      }

      return c.json({
        treasury_sol: treasurySol,
        payout_usdc: payoutUsdc,
        payout_wallet: payout?.walletAddress ?? null,
        facilitator_reachable: facilitatorReachable,
      });
    } catch {
      return c.json({ error: 'Health check failed' }, 503);
    }
  });
  return router;
}
