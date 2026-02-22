import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TransactionDB } from './sqlite.js';

describe('TransactionDB', () => {
  let db: TransactionDB;

  beforeEach(() => {
    db = new TransactionDB(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('creates a buy transaction', () => {
    const tx = db.create({
      type: 'buy',
      wallet: '4KAFtvBGH2y2',
      sol_amount: 10,
      usdc_amount: 10.5,
    });
    expect(tx.id).toBeDefined();
    expect(tx.type).toBe('buy');
    expect(tx.status).toBe('pending');
  });

  it('retrieves a transaction by id', () => {
    const created = db.create({
      type: 'buy',
      wallet: '4KAFtvBGH2y2',
      sol_amount: 5,
      usdc_amount: 5.25,
    });
    const found = db.getById(created.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(created.id);
    expect(found!.sol_amount).toBe(5);
  });

  it('updates transaction status and tx hashes', () => {
    const tx = db.create({
      type: 'buy',
      wallet: '4KAFtvBGH2y2',
      sol_amount: 10,
      usdc_amount: 10.5,
    });
    db.update(tx.id, {
      status: 'completed',
      devnet_tx: '5abc_devnet_sig',
      mainnet_tx: '7def_mainnet_sig',
    });
    const updated = db.getById(tx.id);
    expect(updated!.status).toBe('completed');
    expect(updated!.devnet_tx).toBe('5abc_devnet_sig');
    expect(updated!.mainnet_tx).toBe('7def_mainnet_sig');
  });

  it('returns null for non-existent id', () => {
    const found = db.getById('nonexistent');
    expect(found).toBeNull();
  });

  it('finds pending sell transactions', () => {
    db.create({ type: 'sell', wallet: 'abc', sol_amount: 5, usdc_amount: 4.75 });
    db.create({ type: 'buy', wallet: 'def', sol_amount: 10, usdc_amount: 10.5 });
    db.create({ type: 'sell', wallet: 'ghi', sol_amount: 3, usdc_amount: 2.85 });

    const pending = db.findPendingSells();
    expect(pending).toHaveLength(2);
    expect(pending.every((t) => t.type === 'sell' && t.status === 'pending')).toBe(true);
  });

  it('throws when updating non-existent transaction', () => {
    expect(() => db.update('nonexistent', { status: 'completed' })).toThrow(
      'Transaction not found: nonexistent',
    );
  });

  it('atomicComplete sets completed and returns tx', () => {
    const tx = db.create({ type: 'sell', wallet: 'w', sol_amount: 5, usdc_amount: 4.75, memo: 'devsol-test1' });
    const result = db.atomicComplete(tx.id, 'sig_123');
    expect(result).not.toBeNull();
    expect(result!.status).toBe('completed');
    expect(result!.devnet_tx).toBe('sig_123');
  });

  it('atomicComplete returns null if already completed', () => {
    const tx = db.create({ type: 'sell', wallet: 'w', sol_amount: 5, usdc_amount: 4.75, memo: 'devsol-test2' });
    db.atomicComplete(tx.id, 'sig_first');
    const second = db.atomicComplete(tx.id, 'sig_second');
    expect(second).toBeNull();
    // Verify first sig is preserved
    expect(db.getById(tx.id)!.devnet_tx).toBe('sig_first');
  });

  it('atomicComplete returns null for non-existent id', () => {
    expect(db.atomicComplete('nonexistent', 'sig')).toBeNull();
  });

  it('stores mainnet_payout_tx on update', () => {
    const tx = db.create({ type: 'sell', wallet: 'abc', sol_amount: 5, usdc_amount: 4.75, memo: 'devsol-abc' });
    db.update(tx.id, { mainnet_payout_tx: 'mainnet_sig_abc123' });
    const updated = db.getById(tx.id);
    expect(updated!.mainnet_payout_tx).toBe('mainnet_sig_abc123');
  });

  it('findPendingBuys returns only pending buy orders', () => {
    db.create({ type: 'buy', wallet: 'abc', sol_amount: 1, usdc_amount: 1.05 });
    db.create({ type: 'sell', wallet: 'def', sol_amount: 2, usdc_amount: 1.9 });
    db.create({ type: 'buy', wallet: 'ghi', sol_amount: 3, usdc_amount: 3.15 });
    db.update(db.create({ type: 'buy', wallet: 'jkl', sol_amount: 1, usdc_amount: 1.05 }).id, { status: 'completed' });

    const pending = db.findPendingBuys();
    expect(pending).toHaveLength(2);
    expect(pending.every(tx => tx.type === 'buy' && tx.status === 'pending')).toBe(true);
  });

  it('atomicCompleteBuy sets mainnet_tx and status completed', () => {
    const tx = db.create({ type: 'buy', wallet: 'abc', sol_amount: 1, usdc_amount: 1.05, memo: 'devsol-buy1' });
    const result = db.atomicCompleteBuy(tx.id, 'mainnet_sig_123');
    expect(result).not.toBeNull();
    expect(result!.status).toBe('completed');
    expect(result!.mainnet_tx).toBe('mainnet_sig_123');
  });

  it('atomicCompleteBuy returns null for already-completed buy', () => {
    const tx = db.create({ type: 'buy', wallet: 'abc', sol_amount: 1, usdc_amount: 1.05 });
    db.update(tx.id, { status: 'completed' });
    const result = db.atomicCompleteBuy(tx.id, 'sig');
    expect(result).toBeNull();
  });

  it('prevents duplicate payment IDs', () => {
    db.create({
      type: 'buy',
      wallet: 'abc',
      sol_amount: 10,
      usdc_amount: 10.5,
      mainnet_tx: 'unique_payment',
    });
    expect(() =>
      db.create({
        type: 'buy',
        wallet: 'def',
        sol_amount: 5,
        usdc_amount: 5.25,
        mainnet_tx: 'unique_payment',
      }),
    ).toThrow();
  });

  it('creates transaction with expires_at set to 30 minutes from now', () => {
    const tx = db.create({ type: 'buy', wallet: 'abc', sol_amount: 1, usdc_amount: 1.05 });
    expect(tx.expires_at).toBeDefined();
    const expiresAt = new Date(tx.expires_at + 'Z').getTime();
    const now = Date.now();
    expect(expiresAt).toBeGreaterThan(now + 29 * 60_000);
    expect(expiresAt).toBeLessThan(now + 31 * 60_000);
  });

  it('expireStale marks old pending transactions as expired', () => {
    const tx = db.create({ type: 'sell', wallet: 'abc', sol_amount: 5, usdc_amount: 4.75 });
    db['db'].prepare("UPDATE transactions SET expires_at = datetime('now', '-1 hour') WHERE id = ?").run(tx.id);
    const count = db.expireStale();
    expect(count).toBe(1);
    expect(db.getById(tx.id)!.status).toBe('expired');
  });

  it('expireStale does not touch completed/failed/refunded transactions', () => {
    const tx1 = db.create({ type: 'sell', wallet: 'abc', sol_amount: 5, usdc_amount: 4.75 });
    db.update(tx1.id, { status: 'completed' });
    db['db'].prepare("UPDATE transactions SET expires_at = datetime('now', '-1 hour') WHERE id = ?").run(tx1.id);
    const count = db.expireStale();
    expect(count).toBe(0);
  });

  it('findPendingSells excludes expired transactions', () => {
    db.create({ type: 'sell', wallet: 'abc', sol_amount: 5, usdc_amount: 4.75 });
    const tx2 = db.create({ type: 'sell', wallet: 'def', sol_amount: 3, usdc_amount: 2.85 });
    db['db'].prepare("UPDATE transactions SET expires_at = datetime('now', '-1 hour') WHERE id = ?").run(tx2.id);
    db.expireStale();
    const pending = db.findPendingSells();
    expect(pending).toHaveLength(1);
  });

  it('findPendingBuys excludes expired transactions', () => {
    db.create({ type: 'buy', wallet: 'abc', sol_amount: 1, usdc_amount: 1.05 });
    const tx2 = db.create({ type: 'buy', wallet: 'def', sol_amount: 2, usdc_amount: 2.10 });
    db['db'].prepare("UPDATE transactions SET expires_at = datetime('now', '-1 hour') WHERE id = ?").run(tx2.id);
    db.expireStale();
    const pending = db.findPendingBuys();
    expect(pending).toHaveLength(1);
  });
});
