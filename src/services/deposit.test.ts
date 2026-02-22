import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DepositDetector } from './deposit.js';
import { TransactionDB } from '../db/sqlite.js';

describe('DepositDetector', () => {
  let db: TransactionDB;
  const mockRpc = {
    getSignaturesForAddress: vi.fn(() => ({
      send: vi.fn(async () => []),
    })),
    getTransaction: vi.fn(() => ({
      send: vi.fn(async () => ({
        meta: { preBalances: [10_000_000_000, 0], postBalances: [5_000_000_000, 5_000_000_000] },
      })),
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

  it('calls onDeposit when deposit is confirmed via atomicComplete', async () => {
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
      expect.objectContaining({ id: tx.id, type: 'sell', status: 'completed' }),
      'devnet_deposit_sig',
    );

    const updated = db.getById(tx.id);
    expect(updated!.status).toBe('completed');
    expect(updated!.devnet_tx).toBe('devnet_deposit_sig');
  });

  it('provides wallet and usdc_amount in onDeposit for payout', async () => {
    const onDeposit = vi.fn();
    const tx = db.create({
      type: 'sell',
      wallet: 'Se11erWa11etXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      sol_amount: 5,
      usdc_amount: 4.75,
      memo: 'devsol-payout1',
    });

    const detector = new DepositDetector({
      db, rpc: mockRpc as any, treasuryAddress: 'T', onDeposit,
    });

    await detector.processDeposit(tx.id, 'devnet_sig');
    expect(onDeposit).toHaveBeenCalledWith(
      expect.objectContaining({
        wallet: 'Se11erWa11etXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        usdc_amount: 4.75,
        status: 'completed',
      }),
      'devnet_sig',
    );
  });

  it('skips already-completed transactions (atomicComplete returns null)', async () => {
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
          { memo: '[15] devsol-match1', signature: 'deposit_sig_1' },
          { memo: '[16] unrelated-memo', signature: 'other_sig' },
        ]),
      })),
      getTransaction: vi.fn(() => ({
        send: vi.fn(async () => ({
          meta: { preBalances: [10_000_000_000, 0], postBalances: [5_000_000_000, 5_000_000_000] },
        })),
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

  it('matches whitespace-padded memo from RPC', async () => {
    const onDeposit = vi.fn();
    const tx = db.create({
      type: 'sell',
      wallet: 'seller1',
      sol_amount: 5,
      usdc_amount: 4.75,
      memo: 'devsol-padded1',
    });

    const mockRpcPadded = {
      getSignaturesForAddress: vi.fn(() => ({
        send: vi.fn(async () => [
          { memo: '  devsol-padded1  ', signature: 'padded_sig' },
        ]),
      })),
      getTransaction: vi.fn(() => ({
        send: vi.fn(async () => ({
          meta: { preBalances: [10_000_000_000, 0], postBalances: [5_000_000_000, 5_000_000_000] },
        })),
      })),
    };

    const detector = new DepositDetector({
      db, rpc: mockRpcPadded as any, treasuryAddress: 'T', onDeposit,
    });

    await detector.poll();
    expect(onDeposit).toHaveBeenCalledWith(
      expect.objectContaining({ id: tx.id }),
      'padded_sig',
    );
  });

  it('skips empty and whitespace-only memos', async () => {
    const onDeposit = vi.fn();
    db.create({ type: 'sell', wallet: 'seller1', sol_amount: 5, usdc_amount: 4.75, memo: 'devsol-skip1' });

    const mockRpcEmpty = {
      getSignaturesForAddress: vi.fn(() => ({
        send: vi.fn(async () => [
          { memo: '', signature: 'empty_sig' },
          { memo: '   ', signature: 'whitespace_sig' },
        ]),
      })),
      getTransaction: vi.fn(() => ({
        send: vi.fn(async () => ({
          meta: { preBalances: [10_000_000_000, 0], postBalances: [5_000_000_000, 5_000_000_000] },
        })),
      })),
    };

    const detector = new DepositDetector({
      db, rpc: mockRpcEmpty as any, treasuryAddress: 'T', onDeposit,
    });

    await detector.poll();
    expect(onDeposit).not.toHaveBeenCalled();
  });

  it('strips Solana RPC memo prefix [N] before matching', async () => {
    const onDeposit = vi.fn();
    const tx = db.create({
      type: 'sell',
      wallet: 'seller1',
      sol_amount: 5,
      usdc_amount: 4.75,
      memo: 'devsol-prefix1',
    });

    const mockRpcPrefix = {
      getSignaturesForAddress: vi.fn(() => ({
        send: vi.fn(async () => [
          { memo: '[15] devsol-prefix1', signature: 'prefix_sig' },
        ]),
      })),
      getTransaction: vi.fn(() => ({
        send: vi.fn(async () => ({
          meta: { preBalances: [10_000_000_000, 0], postBalances: [5_000_000_000, 5_000_000_000] },
        })),
      })),
    };

    const detector = new DepositDetector({
      db, rpc: mockRpcPrefix as any, treasuryAddress: 'T', onDeposit,
    });

    await detector.poll();
    expect(onDeposit).toHaveBeenCalledWith(
      expect.objectContaining({ id: tx.id }),
      'prefix_sig',
    );
  });

  it('does not match on memo substring', async () => {
    const onDeposit = vi.fn();
    db.create({ type: 'sell', wallet: 'seller1', sol_amount: 5, usdc_amount: 4.75, memo: 'devsol-abc' });

    const mockRpcSubstring = {
      getSignaturesForAddress: vi.fn(() => ({
        send: vi.fn(async () => [
          { memo: 'xdevsol-abcx', signature: 'wrong_sig' },
        ]),
      })),
      getTransaction: vi.fn(() => ({
        send: vi.fn(async () => ({
          meta: { preBalances: [10_000_000_000, 0], postBalances: [5_000_000_000, 5_000_000_000] },
        })),
      })),
    };

    const detector = new DepositDetector({
      db, rpc: mockRpcSubstring as any, treasuryAddress: 'T', onDeposit,
    });

    await detector.poll();
    expect(onDeposit).not.toHaveBeenCalled();
  });

  it('verifies deposit amount matches expected SOL and calls onDeposit', async () => {
    const onDeposit = vi.fn();
    const tx = db.create({
      type: 'sell', wallet: 'seller1', sol_amount: 5, usdc_amount: 4.75, memo: 'devsol-verify1',
    });

    const rpcWithAmount = {
      getSignaturesForAddress: vi.fn(() => ({
        send: vi.fn(async () => [
          { memo: '[15] devsol-verify1', signature: 'verified_sig' },
        ]),
      })),
      getTransaction: vi.fn(() => ({
        send: vi.fn(async () => ({
          meta: { preBalances: [10_000_000_000, 0], postBalances: [4_999_000_000, 5_000_000_000] },
        })),
      })),
    };

    const detector = new DepositDetector({
      db, rpc: rpcWithAmount as any, treasuryAddress: 'T', onDeposit,
    });

    await detector.poll();
    expect(onDeposit).toHaveBeenCalledWith(expect.objectContaining({ id: tx.id }), 'verified_sig');
  });

  it('rejects deposit when SOL amount is too low', async () => {
    const onDeposit = vi.fn();
    const tx = db.create({
      type: 'sell', wallet: 'seller1', sol_amount: 5, usdc_amount: 4.75, memo: 'devsol-low1',
    });

    const rpcLowAmount = {
      getSignaturesForAddress: vi.fn(() => ({
        send: vi.fn(async () => [
          { memo: '[15] devsol-low1', signature: 'low_sig' },
        ]),
      })),
      getTransaction: vi.fn(() => ({
        send: vi.fn(async () => ({
          meta: { preBalances: [1_000_000_000, 0], postBalances: [999_000_000, 1_000_000] },
        })),
      })),
    };

    const detector = new DepositDetector({
      db, rpc: rpcLowAmount as any, treasuryAddress: 'T', onDeposit,
    });

    await detector.poll();
    expect(onDeposit).not.toHaveBeenCalled();
    expect(db.getById(tx.id)!.status).toBe('failed');
  });
});
