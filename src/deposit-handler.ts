import type { Transaction, UpdateTransactionInput } from './db/sqlite.js';
import { createLogger } from './logger.js';

const log = createLogger('sell-handler');

interface DepositDeps {
  payout?: {
    canAffordPayout(usdcAmount: number): Promise<boolean>;
    sendUsdc(recipient: string, usdcAmount: number): Promise<string>;
  };
  treasury: {
    sendSol(recipient: string, solAmount: number): Promise<string>;
  };
  db: {
    update(id: string, data: UpdateTransactionInput): void;
  };
}

export async function handleDeposit(
  tx: Transaction,
  devnetSig: string,
  deps: DepositDeps,
): Promise<void> {
  log.info(`Deposit confirmed for sell ${tx.id}: ${devnetSig}`);

  if (!deps.payout) {
    log.warn(`No payout service — sell ${tx.id} completed without USDC payout`);
    return;
  }

  try {
    const canPay = await deps.payout.canAffordPayout(tx.usdc_amount);
    if (!canPay) {
      log.error(`Insufficient USDC reserves for sell ${tx.id} — refunding`);
      const refundSig = await deps.treasury.sendSol(tx.wallet, tx.sol_amount);
      deps.db.update(tx.id, { status: 'refunded' });
      log.info(`Refunded ${tx.sol_amount} SOL to ${tx.wallet}: ${refundSig}`);
      return;
    }

    const mainnetSig = await deps.payout.sendUsdc(tx.wallet, tx.usdc_amount);
    deps.db.update(tx.id, { mainnet_payout_tx: mainnetSig });
    log.info(`USDC payout sent for sell ${tx.id}: ${mainnetSig}`);
  } catch (err) {
    log.error({ err }, `USDC payout failed for sell ${tx.id}`);
    try {
      const refundSig = await deps.treasury.sendSol(tx.wallet, tx.sol_amount);
      deps.db.update(tx.id, { status: 'refunded' });
      log.info(`Refunded ${tx.sol_amount} SOL to ${tx.wallet}: ${refundSig} (original deposit: ${tx.devnet_tx})`);
    } catch (refundErr) {
      log.error({ err: refundErr }, `CRITICAL: Refund also failed for sell ${tx.id}`);
      deps.db.update(tx.id, { status: 'failed' });
    }
  }
}
