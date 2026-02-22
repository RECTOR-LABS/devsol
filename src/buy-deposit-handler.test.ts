import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleBuyDeposit } from './buy-deposit-handler.js';
import type { Transaction } from './db/sqlite.js';

function makeTx(overrides?: Partial<Transaction>): Transaction {
  return {
    id: 'buy-001',
    type: 'buy',
    wallet: 'BuyerWa11etXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    sol_amount: 1,
    usdc_amount: 1.05,
    mainnet_tx: 'mainnet_deposit_sig',
    devnet_tx: null,
    mainnet_payout_tx: null,
    memo: 'devsol-buy1',
    status: 'completed',
    expires_at: '2026-01-01T00:30:00',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeDeps() {
  return {
    treasury: {
      sendSol: vi.fn(async () => 'devnet_delivery_sig'),
    },
    payout: {
      sendUsdc: vi.fn(async () => 'refund_sig_123'),
    },
    db: {
      update: vi.fn(),
    },
  };
}

describe('handleBuyDeposit', () => {
  beforeEach(() => vi.clearAllMocks());

  it('delivers devnet SOL and records devnet_tx on success', async () => {
    const deps = makeDeps();
    const tx = makeTx();

    await handleBuyDeposit(tx, 'mainnet_deposit_sig', deps);

    expect(deps.treasury.sendSol).toHaveBeenCalledWith(tx.wallet, 1);
    expect(deps.db.update).toHaveBeenCalledWith('buy-001', { devnet_tx: 'devnet_delivery_sig' });
    expect(deps.payout.sendUsdc).not.toHaveBeenCalled();
  });

  it('refunds USDC when treasury delivery fails', async () => {
    const deps = makeDeps();
    deps.treasury.sendSol.mockRejectedValue(new Error('no SOL'));
    const tx = makeTx();

    await handleBuyDeposit(tx, 'mainnet_deposit_sig', deps);

    expect(deps.payout.sendUsdc).toHaveBeenCalledWith(tx.wallet, 1.05);
    expect(deps.db.update).toHaveBeenCalledWith('buy-001', { status: 'refunded' });
  });

  it('sets status failed when both delivery and refund fail', async () => {
    const deps = makeDeps();
    deps.treasury.sendSol.mockRejectedValue(new Error('Devnet down'));
    deps.payout.sendUsdc.mockRejectedValue(new Error('USDC refund failed'));
    const tx = makeTx();

    await handleBuyDeposit(tx, 'mainnet_deposit_sig', deps);

    expect(deps.db.update).toHaveBeenCalledWith('buy-001', { status: 'failed' });
  });

  it('sets status failed when no payout service for refund', async () => {
    const deps = makeDeps();
    deps.treasury.sendSol.mockRejectedValue(new Error('Devnet down'));
    const tx = makeTx();

    await handleBuyDeposit(tx, 'mainnet_deposit_sig', { ...deps, payout: undefined });

    expect(deps.db.update).toHaveBeenCalledWith('buy-001', { status: 'failed' });
  });
});
