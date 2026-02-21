import { Hono } from 'hono';
import { randomUUID } from 'crypto';
import type { TransactionDB } from '../db/sqlite.js';
import type { PricingService } from '../services/pricing.js';

interface SellDeps {
  db: TransactionDB;
  pricing: PricingService;
  treasuryAddress: string;
}

export function sellRoutes({ db, pricing, treasuryAddress }: SellDeps) {
  const router = new Hono();

  router.post('/sell', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body?.wallet || !body?.amount_sol || body.amount_sol <= 0) {
      return c.json({ error: 'Invalid request: wallet and positive amount_sol required' }, 400);
    }

    const { wallet, amount_sol } = body;
    const quote = pricing.sellQuote(amount_sol);
    const memo = `devsol-${randomUUID().slice(0, 8)}`;

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
  });

  return router;
}
