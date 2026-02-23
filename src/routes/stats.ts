import { Hono } from 'hono';
import type { TransactionDB } from '../db/sqlite.js';
import type { PricingService } from '../services/pricing.js';

export function statsRoutes(db: TransactionDB, pricing: PricingService) {
  const router = new Hono();

  router.get('/stats', (c) => {
    const counts = db.countByStatus();
    const summary = pricing.summary();
    const denominator = counts.completed + counts.failed + counts.refunded;
    const successRate = denominator > 0 ? Math.round((counts.completed / denominator) * 1000) / 10 : 0;

    return c.json({
      total_trades: counts.total,
      completed_trades: counts.completed,
      pending_orders: counts.pending,
      failed_trades: counts.failed,
      refunded_trades: counts.refunded,
      success_rate: successRate,
      buy_rate: summary.buy.usdc_per_sol,
      sell_rate: summary.sell.usdc_per_sol,
      spread: summary.spread,
      network_fees: 'included',
    });
  });

  return router;
}
