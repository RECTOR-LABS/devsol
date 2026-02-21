import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DepositDetector } from './deposit.js';
import { TransactionDB } from '../db/sqlite.js';

describe('DepositDetector', () => {
  let db: TransactionDB;
  const mockRpc = {
    getSignaturesForAddress: vi.fn(() => ({
      send: vi.fn(async () => []),
    })),
  };

  beforeEach(() => {
    db = new TransactionDB(':memory:');
    vi.clearAllMocks();
  });

  afterEach(() => db.close());

  it('finds pending sell orders to check', () => {
    db.create({ type: 'sell', wallet: 'abc', sol_amount: 5, usdc_amount: 4.75, memo: 'devsol-abc' });
    db.create({ type: 'buy', wallet: 'def', sol_amount: 10, usdc_amount: 10.5 });

    const pending = db.findPendingSells();
    expect(pending).toHaveLength(1);
    expect(pending[0].memo).toBe('devsol-abc');
  });

  it('calls onDeposit when deposit is confirmed', async () => {
    const onDeposit = vi.fn();
    const tx = db.create({
      type: 'sell',
      wallet: 'seller1',
      sol_amount: 5,
      usdc_amount: 4.75,
      memo: 'devsol-test123',
    });

    const detector = new DepositDetector({
      db,
      rpc: mockRpc as any,
      treasuryAddress: 'TreasuryAddr',
      onDeposit,
    });

    await detector.processDeposit(tx.id, 'devnet_deposit_sig');
    expect(onDeposit).toHaveBeenCalledWith(
      expect.objectContaining({ id: tx.id, type: 'sell' }),
      'devnet_deposit_sig',
    );

    const updated = db.getById(tx.id);
    expect(updated!.status).toBe('completed');
    expect(updated!.devnet_tx).toBe('devnet_deposit_sig');
  });

  it('skips already-completed transactions', async () => {
    const onDeposit = vi.fn();
    const tx = db.create({
      type: 'sell',
      wallet: 'seller1',
      sol_amount: 5,
      usdc_amount: 4.75,
      memo: 'devsol-done',
    });
    db.update(tx.id, { status: 'completed' });

    const detector = new DepositDetector({
      db,
      rpc: mockRpc as any,
      treasuryAddress: 'TreasuryAddr',
      onDeposit,
    });

    await detector.processDeposit(tx.id, 'some_sig');
    expect(onDeposit).not.toHaveBeenCalled();
  });

  it('polls and matches deposits by memo', async () => {
    const onDeposit = vi.fn();
    const tx = db.create({
      type: 'sell',
      wallet: 'seller1',
      sol_amount: 5,
      usdc_amount: 4.75,
      memo: 'devsol-match1',
    });

    const mockRpcWithDeposit = {
      getSignaturesForAddress: vi.fn(() => ({
        send: vi.fn(async () => [
          { memo: 'devsol-match1', signature: 'deposit_sig_1' },
          { memo: 'unrelated-memo', signature: 'other_sig' },
        ]),
      })),
    };

    const detector = new DepositDetector({
      db,
      rpc: mockRpcWithDeposit as any,
      treasuryAddress: 'TreasuryAddr',
      onDeposit,
    });

    await detector.poll();
    expect(onDeposit).toHaveBeenCalledWith(
      expect.objectContaining({ id: tx.id }),
      'deposit_sig_1',
    );
    expect(db.getById(tx.id)!.status).toBe('completed');
  });
});
