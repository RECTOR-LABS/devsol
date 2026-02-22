import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleDeposit } from './deposit-handler.js';
import type { Transaction } from './db/sqlite.js';

function makeTx(overrides?: Partial<Transaction>): Transaction {
  return {
    id: 'sell-001',
    type: 'sell',
    wallet: 'Se11erWa11etXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    sol_amount: 5,
    usdc_amount: 4.75,
    mainnet_tx: null,
    devnet_tx: 'devnet_sig_123',
    mainnet_payout_tx: null,
    memo: 'devsol-test1',
    status: 'completed',
    expires_at: '2026-01-01T00:30:00',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeDeps() {
  return {
    payout: {
      canAffordPayout: vi.fn(async () => true),
      sendUsdc: vi.fn(async () => 'mainnet_payout_sig'),
    },
    treasury: {
      sendSol: vi.fn(async () => 'refund_sig_123'),
    },
    db: {
      update: vi.fn(),
    },
  };
}

describe('handleDeposit', () => {
  beforeEach(() => vi.clearAllMocks());

  it('logs warning and returns when no payout service', async () => {
    const deps = makeDeps();
    const tx = makeTx();

    await handleDeposit(tx, 'devnet_sig', { ...deps, payout: undefined });

    expect(deps.payout.sendUsdc).not.toHaveBeenCalled();
    expect(deps.db.update).not.toHaveBeenCalled();
  });

  it('sends USDC payout and updates DB on success', async () => {
    const deps = makeDeps();
    const tx = makeTx();

    await handleDeposit(tx, 'devnet_sig', deps);

    expect(deps.payout.canAffordPayout).toHaveBeenCalledWith(4.75);
    expect(deps.payout.sendUsdc).toHaveBeenCalledWith(tx.wallet, 4.75);
    expect(deps.db.update).toHaveBeenCalledWith('sell-001', { mainnet_payout_tx: 'mainnet_payout_sig' });
  });

  it('refunds SOL when reserves insufficient', async () => {
    const deps = makeDeps();
    deps.payout.canAffordPayout.mockResolvedValue(false);
    const tx = makeTx();

    await handleDeposit(tx, 'devnet_sig', deps);

    expect(deps.payout.sendUsdc).not.toHaveBeenCalled();
    expect(deps.treasury.sendSol).toHaveBeenCalledWith(tx.wallet, 5);
    expect(deps.db.update).toHaveBeenCalledWith('sell-001', { status: 'refunded' });
  });

  it('refunds SOL when payout throws', async () => {
    const deps = makeDeps();
    deps.payout.sendUsdc.mockRejectedValue(new Error('RPC timeout'));
    const tx = makeTx();

    await handleDeposit(tx, 'devnet_sig', deps);

    expect(deps.treasury.sendSol).toHaveBeenCalledWith(tx.wallet, 5);
    expect(deps.db.update).toHaveBeenCalledWith('sell-001', { status: 'refunded' });
  });

  it('sets status failed when both payout and refund throw', async () => {
    const deps = makeDeps();
    deps.payout.sendUsdc.mockRejectedValue(new Error('RPC timeout'));
    deps.treasury.sendSol.mockRejectedValue(new Error('Devnet down'));
    const tx = makeTx();

    await handleDeposit(tx, 'devnet_sig', deps);

    expect(deps.db.update).toHaveBeenCalledWith('sell-001', { status: 'failed' });
  });
});
