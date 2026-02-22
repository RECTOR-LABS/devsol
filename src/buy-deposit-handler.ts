import type { Transaction, UpdateTransactionInput } from './db/sqlite.js';
import { createLogger } from './logger.js';

const log = createLogger('buy-handler');

interface BuyDepositDeps {
  treasury: {
    sendSol(recipient: string, solAmount: number): Promise<string>;
  };
  payout?: {
    sendUsdc(recipient: string, usdcAmount: number): Promise<string>;
  };
  db: {
    update(id: string, data: UpdateTransactionInput): void;
  };
}

export async function handleBuyDeposit(
  tx: Transaction,
  mainnetSig: string,
  deps: BuyDepositDeps,
): Promise<void> {
  log.info(`USDC deposit confirmed for buy ${tx.id}: ${mainnetSig}`);

  try {
    const devnetSig = await deps.treasury.sendSol(tx.wallet, tx.sol_amount);
    deps.db.update(tx.id, { devnet_tx: devnetSig });
    log.info(`Devnet SOL delivered for buy ${tx.id}: ${devnetSig}`);
  } catch (err) {
    log.error({ err }, `Devnet SOL delivery failed for buy ${tx.id}`);

    if (!deps.payout) {
      log.error(`No payout service — cannot refund USDC for buy ${tx.id}`);
      deps.db.update(tx.id, { status: 'failed' });
      return;
    }

    try {
      const refundSig = await deps.payout.sendUsdc(tx.wallet, tx.usdc_amount);
      deps.db.update(tx.id, { status: 'refunded' });
      log.info(`Refunded ${tx.usdc_amount} USDC to ${tx.wallet}: ${refundSig}`);
    } catch (refundErr) {
      log.error({ err: refundErr }, `CRITICAL: USDC refund also failed for buy ${tx.id}`);
      deps.db.update(tx.id, { status: 'failed' });
    }
  }
}
