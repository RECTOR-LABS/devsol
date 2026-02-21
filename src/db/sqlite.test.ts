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
});
