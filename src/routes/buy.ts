import { Hono } from 'hono';
import { randomUUID } from 'crypto';
import type { TransactionDB } from '../db/sqlite.js';
import type { PricingService } from '../services/pricing.js';
import type { TreasuryService } from '../services/treasury.js';
import { validateBuySellBody } from '../validation.js';

interface BuyDeps {
  db: TransactionDB;
  pricing: PricingService;
  treasury: TreasuryService;
  payoutAddress: string;
}

export function buyRoutes({ db, pricing, treasury, payoutAddress }: BuyDeps) {
  const router = new Hono();

  router.post('/buy', async (c) => {
    const body = await c.req.json().catch(() => null);
    const validated = validateBuySellBody(body);
    if (typeof validated === 'string') {
      return c.json({ error: validated, code: 'INVALID_REQUEST' }, 400);
    }

    const { wallet, amount_sol } = validated;
    const quote = pricing.buyQuote(amount_sol);

    // Balance pre-check: treasury must hold enough SOL to deliver
    const balance = await treasury.getBalance();
    if (balance < amount_sol) {
      return c.json({ error: 'Buy temporarily unavailable: insufficient reserves', code: 'INSUFFICIENT_RESERVES' }, 503);
    }

    const memo = `devsol-${randomUUID().slice(0, 8)}`;

    try {
      const tx = db.create({
        type: 'buy',
        wallet,
        sol_amount: amount_sol,
        usdc_amount: quote.usdc_amount,
        memo,
      });

      return c.json({
        transaction_id: tx.id,
        status: 'pending',
        deposit_address: payoutAddress,
        memo,
        amount_sol,
        usdc_cost: quote.usdc_amount,
        instructions: `Send exactly ${quote.usdc_amount} USDC to ${payoutAddress} on Solana mainnet with memo: ${memo}`,
      });
    } catch {
      return c.json({ error: 'Failed to create buy order', code: 'INTERNAL_ERROR' }, 500);
    }
  });

  return router;
}
