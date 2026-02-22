import type { Transaction, UpdateTransactionInput } from './db/sqlite.js';

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
  console.log(`USDC deposit confirmed for buy ${tx.id}: ${mainnetSig}`);

  try {
    const devnetSig = await deps.treasury.sendSol(tx.wallet, tx.sol_amount);
    deps.db.update(tx.id, { devnet_tx: devnetSig });
    console.log(`Devnet SOL delivered for buy ${tx.id}: ${devnetSig}`);
  } catch (err) {
    console.error(`Devnet SOL delivery failed for buy ${tx.id}:`, err);

    if (!deps.payout) {
      console.error(`No payout service — cannot refund USDC for buy ${tx.id}`);
      deps.db.update(tx.id, { status: 'failed' });
      return;
    }

    try {
      const refundSig = await deps.payout.sendUsdc(tx.wallet, tx.usdc_amount);
      deps.db.update(tx.id, { status: 'refunded' });
      console.log(`Refunded ${tx.usdc_amount} USDC to ${tx.wallet}: ${refundSig}`);
    } catch (refundErr) {
      console.error(`CRITICAL: USDC refund also failed for buy ${tx.id}:`, refundErr);
      deps.db.update(tx.id, { status: 'failed' });
    }
  }
}
