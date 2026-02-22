import { Hono } from 'hono';
import { randomUUID } from 'crypto';
import type { TransactionDB } from '../db/sqlite.js';
import type { PricingService } from '../services/pricing.js';
import { validateBuySellBody } from '../validation.js';

interface SellDeps {
  db: TransactionDB;
  pricing: PricingService;
  treasuryAddress: string;
  payout?: { canAffordPayout(usdcAmount: number): Promise<boolean> };
}

export function sellRoutes({ db, pricing, treasuryAddress, payout }: SellDeps) {
  const router = new Hono();

  router.post('/sell', async (c) => {
    const body = await c.req.json().catch(() => null);
    const validated = validateBuySellBody(body);
    if (typeof validated === 'string') {
      return c.json({ error: validated }, 400);
    }

    const { wallet, amount_sol } = validated;
    const quote = pricing.sellQuote(amount_sol);

    if (payout) {
      const canPay = await payout.canAffordPayout(quote.usdc_amount);
      if (!canPay) {
        return c.json({ error: 'Sell temporarily unavailable: insufficient reserves', code: 'INSUFFICIENT_RESERVES' }, 503);
      }
    }

    const memo = `devsol-${randomUUID().slice(0, 8)}`;

    try {
      const tx = db.create({
        type: 'sell',
        wallet,
        sol_amount: amount_sol,
        usdc_amount: quote.usdc_amount,
        memo,
      });

      return c.json({
        transaction_id: tx.id,
        status: 'pending',
        deposit_address: treasuryAddress,
        memo,
        amount_sol,
        usdc_payout: quote.usdc_amount,
        instructions: `Send exactly ${amount_sol} SOL to ${treasuryAddress} on Solana devnet with memo: ${memo}`,
      });
    } catch {
      return c.json({ error: 'Failed to create sell order' }, 500);
    }
  });

  return router;
}
