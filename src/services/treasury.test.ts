import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TreasuryService } from './treasury.js';

// Mock @solana/kit — we don't want real RPC calls in unit tests
vi.mock('@solana/kit', () => ({
  createSolanaRpc: vi.fn(() => ({
    getBalance: vi.fn(() => ({
      send: vi.fn(async () => ({ value: 7000_000_000_000n })),
    })),
    getLatestBlockhash: vi.fn(() => ({
      send: vi.fn(async () => ({
        value: {
          blockhash: 'FakeBlockhash11111111111111111111111111111111' as any,
          lastValidBlockHeight: 1000n,
        },
      })),
    })),
  })),
  createSolanaRpcSubscriptions: vi.fn(() => ({})),
  sendAndConfirmTransactionFactory: vi.fn(() =>
    vi.fn(async () => undefined),
  ),
  createKeyPairSignerFromBytes: vi.fn(async () => ({
    address: 'SoLTreasuryAddressDevXXXXXXXXXXXXXXXXXXXXXXX' as any,
  })),
  address: vi.fn((addr: string) => addr),
  lamports: vi.fn((n: bigint) => n),
  pipe: vi.fn((...fns: any[]) => {
    let result = fns[0];
    for (let i = 1; i < fns.length; i++) result = fns[i](result);
    return result;
  }),
  createTransactionMessage: vi.fn(() => ({})),
  setTransactionMessageFeePayerSigner: vi.fn(() => (_: any) => ({})),
  setTransactionMessageLifetimeUsingBlockhash: vi.fn(() => (_: any) => ({})),
  appendTransactionMessageInstruction: vi.fn(() => (_: any) => ({})),
  signTransactionMessageWithSigners: vi.fn(async () => ({})),
  getSignatureFromTransaction: vi.fn(() => 'FakeSignature1111111111111111111111111111111111111'),
}));

vi.mock('@solana-program/system', () => ({
  getTransferSolInstruction: vi.fn(() => ({})),
}));

describe('TreasuryService', () => {
  let treasury: TreasuryService;

  beforeEach(async () => {
    treasury = await TreasuryService.create({
      rpcUrl: 'https://api.devnet.solana.com',
      wssUrl: 'wss://api.devnet.solana.com',
      keypairBytes: new Uint8Array(64),
    });
  });

  it('reports treasury address', () => {
    expect(treasury.address).toBeDefined();
    expect(typeof treasury.address).toBe('string');
  });

  it('gets balance in SOL', async () => {
    const balance = await treasury.getBalance();
    expect(balance).toBe(7000); // 7000_000_000_000 lamports = 7000 SOL
  });

  it('sends SOL to a recipient', async () => {
    const sig = await treasury.sendSol('RecipientAddress1111111111111111111111111', 10);
    expect(sig).toBeDefined();
    expect(typeof sig).toBe('string');
  });

  it('rejects zero or negative SOL amounts', async () => {
    await expect(treasury.sendSol('Recipient', 0)).rejects.toThrow();
    await expect(treasury.sendSol('Recipient', -5)).rejects.toThrow();
  });
});
