import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BuyDepositDetector } from './buy-deposit.js';
import { TransactionDB } from '../db/sqlite.js';

describe('BuyDepositDetector', () => {
  let db: TransactionDB;
  const mockRpc = {
    getSignaturesForAddress: vi.fn(() => ({
      send: vi.fn(async () => []),
    })),
    getTransaction: vi.fn(() => ({
      send: vi.fn(async () => ({
        meta: {
          preTokenBalances: [{ mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', uiTokenAmount: { amount: '0' } }],
          postTokenBalances: [{ mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', uiTokenAmount: { amount: '100000000' } }],
        },
      })),
    })),
  };

  beforeEach(() => {
    db = new TransactionDB(':memory:');
    vi.clearAllMocks();
  });

  afterEach(() => db.close());

  it('polls and matches buy deposits by memo', async () => {
    const onDeposit = vi.fn();
    const tx = db.create({
      type: 'buy', wallet: 'buyer1', sol_amount: 1, usdc_amount: 1.05, memo: 'devsol-buy1',
    });

    const mockRpcWithDeposit = {
      getSignaturesForAddress: vi.fn(() => ({
        send: vi.fn(async () => [
          { memo: '[15] devsol-buy1', signature: 'mainnet_usdc_sig' },
        ]),
      })),
      getTransaction: vi.fn(() => ({
        send: vi.fn(async () => ({
          meta: {
            preTokenBalances: [{ mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', uiTokenAmount: { amount: '0' } }],
            postTokenBalances: [{ mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', uiTokenAmount: { amount: '100000000' } }],
          },
        })),
      })),
    };

    const detector = new BuyDepositDetector({
      db, rpc: mockRpcWithDeposit as any, usdcAtaAddress: 'UsdcAta', onDeposit,
    });

    await detector.poll();
    expect(onDeposit).toHaveBeenCalledWith(
      expect.objectContaining({ id: tx.id, status: 'completed' }),
      'mainnet_usdc_sig',
    );
  });

  it('skips already-completed buys', async () => {
    const onDeposit = vi.fn();
    const tx = db.create({
      type: 'buy', wallet: 'buyer1', sol_amount: 1, usdc_amount: 1.05, memo: 'devsol-done',
    });
    db.update(tx.id, { status: 'completed' });

    const detector = new BuyDepositDetector({
      db, rpc: mockRpc as any, usdcAtaAddress: 'UsdcAta', onDeposit,
    });

    await detector.processDeposit(tx.id, 'some_sig');
    expect(onDeposit).not.toHaveBeenCalled();
  });

  it('strips RPC memo prefix before matching', async () => {
    const onDeposit = vi.fn();
    const tx = db.create({
      type: 'buy', wallet: 'buyer1', sol_amount: 1, usdc_amount: 1.05, memo: 'devsol-strip1',
    });

    const mockRpcPrefix = {
      getSignaturesForAddress: vi.fn(() => ({
        send: vi.fn(async () => [
          { memo: '[16] devsol-strip1', signature: 'prefix_sig' },
        ]),
      })),
      getTransaction: vi.fn(() => ({
        send: vi.fn(async () => ({
          meta: {
            preTokenBalances: [{ mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', uiTokenAmount: { amount: '0' } }],
            postTokenBalances: [{ mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', uiTokenAmount: { amount: '100000000' } }],
          },
        })),
      })),
    };

    const detector = new BuyDepositDetector({
      db, rpc: mockRpcPrefix as any, usdcAtaAddress: 'UsdcAta', onDeposit,
    });

    await detector.poll();
    expect(onDeposit).toHaveBeenCalledWith(
      expect.objectContaining({ id: tx.id }),
      'prefix_sig',
    );
  });

  it('does not match sell orders', async () => {
    const onDeposit = vi.fn();
    db.create({ type: 'sell', wallet: 'seller1', sol_amount: 1, usdc_amount: 0.95, memo: 'devsol-sell1' });

    const mockRpcSell = {
      getSignaturesForAddress: vi.fn(() => ({
        send: vi.fn(async () => [
          { memo: 'devsol-sell1', signature: 'sell_sig' },
        ]),
      })),
      getTransaction: vi.fn(() => ({
        send: vi.fn(async () => ({
          meta: {
            preTokenBalances: [{ mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', uiTokenAmount: { amount: '0' } }],
            postTokenBalances: [{ mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', uiTokenAmount: { amount: '100000000' } }],
          },
        })),
      })),
    };

    const detector = new BuyDepositDetector({
      db, rpc: mockRpcSell as any, usdcAtaAddress: 'UsdcAta', onDeposit,
    });

    await detector.poll();
    expect(onDeposit).not.toHaveBeenCalled();
  });

  it('provides wallet and sol_amount in onDeposit for devnet delivery', async () => {
    const onDeposit = vi.fn();
    db.create({
      type: 'buy',
      wallet: 'BuyerWa11etXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      sol_amount: 2.5,
      usdc_amount: 2.63,
      memo: 'devsol-delivery1',
    });

    const mockRpcDelivery = {
      getSignaturesForAddress: vi.fn(() => ({
        send: vi.fn(async () => [
          { memo: '[18] devsol-delivery1', signature: 'delivery_sig' },
        ]),
      })),
      getTransaction: vi.fn(() => ({
        send: vi.fn(async () => ({
          meta: {
            preTokenBalances: [{ mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', uiTokenAmount: { amount: '0' } }],
            postTokenBalances: [{ mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', uiTokenAmount: { amount: '100000000' } }],
          },
        })),
      })),
    };

    const detector = new BuyDepositDetector({
      db, rpc: mockRpcDelivery as any, usdcAtaAddress: 'UsdcAta', onDeposit,
    });

    await detector.poll();
    expect(onDeposit).toHaveBeenCalledWith(
      expect.objectContaining({
        wallet: 'BuyerWa11etXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        sol_amount: 2.5,
        status: 'completed',
      }),
      'delivery_sig',
    );
  });

  it('matches whitespace-padded memo from RPC', async () => {
    const onDeposit = vi.fn();
    const tx = db.create({
      type: 'buy', wallet: 'buyer1', sol_amount: 1, usdc_amount: 1.05, memo: 'devsol-padded1',
    });

    const mockRpcPadded = {
      getSignaturesForAddress: vi.fn(() => ({
        send: vi.fn(async () => [
          { memo: '  devsol-padded1  ', signature: 'padded_sig' },
        ]),
      })),
      getTransaction: vi.fn(() => ({
        send: vi.fn(async () => ({
          meta: {
            preTokenBalances: [{ mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', uiTokenAmount: { amount: '0' } }],
            postTokenBalances: [{ mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', uiTokenAmount: { amount: '100000000' } }],
          },
        })),
      })),
    };

    const detector = new BuyDepositDetector({
      db, rpc: mockRpcPadded as any, usdcAtaAddress: 'UsdcAta', onDeposit,
    });

    await detector.poll();
    expect(onDeposit).toHaveBeenCalledWith(
      expect.objectContaining({ id: tx.id }),
      'padded_sig',
    );
  });

  it('skips empty and whitespace-only memos', async () => {
    const onDeposit = vi.fn();
    db.create({ type: 'buy', wallet: 'buyer1', sol_amount: 1, usdc_amount: 1.05, memo: 'devsol-skip1' });

    const mockRpcEmpty = {
      getSignaturesForAddress: vi.fn(() => ({
        send: vi.fn(async () => [
          { memo: '', signature: 'empty_sig' },
          { memo: '   ', signature: 'whitespace_sig' },
        ]),
      })),
      getTransaction: vi.fn(() => ({
        send: vi.fn(async () => ({
          meta: {
            preTokenBalances: [{ mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', uiTokenAmount: { amount: '0' } }],
            postTokenBalances: [{ mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', uiTokenAmount: { amount: '100000000' } }],
          },
        })),
      })),
    };

    const detector = new BuyDepositDetector({
      db, rpc: mockRpcEmpty as any, usdcAtaAddress: 'UsdcAta', onDeposit,
    });

    await detector.poll();
    expect(onDeposit).not.toHaveBeenCalled();
  });

  it('does not match on memo substring', async () => {
    const onDeposit = vi.fn();
    db.create({ type: 'buy', wallet: 'buyer1', sol_amount: 1, usdc_amount: 1.05, memo: 'devsol-abc' });

    const mockRpcSubstring = {
      getSignaturesForAddress: vi.fn(() => ({
        send: vi.fn(async () => [
          { memo: 'xdevsol-abcx', signature: 'wrong_sig' },
        ]),
      })),
      getTransaction: vi.fn(() => ({
        send: vi.fn(async () => ({
          meta: {
            preTokenBalances: [{ mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', uiTokenAmount: { amount: '0' } }],
            postTokenBalances: [{ mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', uiTokenAmount: { amount: '100000000' } }],
          },
        })),
      })),
    };

    const detector = new BuyDepositDetector({
      db, rpc: mockRpcSubstring as any, usdcAtaAddress: 'UsdcAta', onDeposit,
    });

    await detector.poll();
    expect(onDeposit).not.toHaveBeenCalled();
  });

  it('verifies USDC deposit amount matches expected and calls onDeposit', async () => {
    const onDeposit = vi.fn();
    const tx = db.create({
      type: 'buy', wallet: 'buyer1', sol_amount: 1, usdc_amount: 1.05, memo: 'devsol-buyverify1',
    });

    const rpcWithAmount = {
      getSignaturesForAddress: vi.fn(() => ({
        send: vi.fn(async () => [
          { memo: '[20] devsol-buyverify1', signature: 'buy_verified_sig' },
        ]),
      })),
      getTransaction: vi.fn(() => ({
        send: vi.fn(async () => ({
          meta: {
            preTokenBalances: [{ mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', uiTokenAmount: { amount: '10000000' } }],
            postTokenBalances: [{ mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', uiTokenAmount: { amount: '11050000' } }],
          },
        })),
      })),
    };

    const detector = new BuyDepositDetector({
      db, rpc: rpcWithAmount as any, usdcAtaAddress: 'ATA', onDeposit,
    });

    await detector.poll();
    expect(onDeposit).toHaveBeenCalledWith(expect.objectContaining({ id: tx.id }), 'buy_verified_sig');
  });

  it('rejects buy deposit when USDC amount is too low', async () => {
    const onDeposit = vi.fn();
    const tx = db.create({
      type: 'buy', wallet: 'buyer1', sol_amount: 1, usdc_amount: 1.05, memo: 'devsol-buylow1',
    });

    const rpcLowAmount = {
      getSignaturesForAddress: vi.fn(() => ({
        send: vi.fn(async () => [
          { memo: '[20] devsol-buylow1', signature: 'buy_low_sig' },
        ]),
      })),
      getTransaction: vi.fn(() => ({
        send: vi.fn(async () => ({
          meta: {
            preTokenBalances: [{ mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', uiTokenAmount: { amount: '10000000' } }],
            postTokenBalances: [{ mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', uiTokenAmount: { amount: '10010000' } }],
          },
        })),
      })),
    };

    const detector = new BuyDepositDetector({
      db, rpc: rpcLowAmount as any, usdcAtaAddress: 'ATA', onDeposit,
    });

    await detector.poll();
    expect(onDeposit).not.toHaveBeenCalled();
    expect(db.getById(tx.id)!.status).toBe('failed');
  });
});
