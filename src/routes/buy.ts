import { Hono } from 'hono';
import type { TransactionDB } from '../db/sqlite.js';
import type { PricingService } from '../services/pricing.js';
import type { TreasuryService } from '../services/treasury.js';
import type { X402Service } from '../services/x402.js';
import { validateBuySellBody } from '../validation.js';

interface BuyDeps {
  db: TransactionDB;
  pricing: PricingService;
  treasury: TreasuryService;
  x402: X402Service;
}

export function buyRoutes({ db, pricing, treasury, x402 }: BuyDeps) {
  const router = new Hono();

  router.post('/buy', async (c) => {
    const body = await c.req.json().catch(() => null);
    const validated = validateBuySellBody(body);
    if (typeof validated === 'string') {
      return c.json({ error: validated, code: 'INVALID_REQUEST' }, 400);
    }

    const { wallet, amount_sol } = validated;
    const quote = pricing.buyQuote(amount_sol);

    // Balance pre-check
    const balance = await treasury.getBalance();
    if (balance < amount_sol) {
      return c.json({ error: 'Buy temporarily unavailable: insufficient reserves', code: 'INSUFFICIENT_RESERVES' }, 503);
    }

    const paymentHeader = c.req.header('payment-signature');

    if (!paymentHeader) {
      const payload = x402.createPaymentRequired(quote.usdc_amount, `Buy ${amount_sol} SOL devnet`);
      c.header('payment-required', x402.encodePaymentRequiredHeader(payload));
      return c.json(payload, 402);
    }

    const verification = await x402.verifyPayment(paymentHeader, quote.usdc_amount);
    if (!verification.isValid) {
      const payload = x402.createPaymentRequired(quote.usdc_amount, `Payment invalid: ${verification.invalidReason ?? 'unknown'}`);
      c.header('payment-required', x402.encodePaymentRequiredHeader(payload));
      return c.json(payload, 402);
    }

    const tx = db.create({
      type: 'buy',
      wallet,
      sol_amount: amount_sol,
      usdc_amount: quote.usdc_amount,
      mainnet_tx: paymentHeader,
    });

    try {
      const devnetSig = await treasury.sendSol(wallet, amount_sol);
      db.update(tx.id, { status: 'completed', devnet_tx: devnetSig });
      // Settle async — don't block response
      x402.settlePayment(paymentHeader, quote.usdc_amount).catch((err) =>
        console.error(`Settlement failed for tx ${tx.id}:`, err),
      );
      return c.json({ ...db.getById(tx.id) });
    } catch (err) {
      console.error('Buy delivery failed:', err);
      db.update(tx.id, { status: 'failed' });
      return c.json({ error: 'Delivery failed', code: 'DELIVERY_FAILED', transaction_id: tx.id }, 500);
    }
  });

  return router;
}
