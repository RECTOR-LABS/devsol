import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  sendAndConfirmTransactionFactory,
  createKeyPairSignerFromBytes,
  address,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  getSignatureFromTransaction,
  type KeyPairSigner,
  type Rpc,
  type SolanaRpcApi,
} from '@solana/kit';

import {
  findAssociatedTokenPda,
  getTransferCheckedInstruction,
  getCreateAssociatedTokenIdempotentInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';

const USDC_MINT = address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const USDC_DECIMALS = 6;

export function usdcToAtomicUnits(usdcAmount: number): bigint {
  const str = usdcAmount.toFixed(USDC_DECIMALS);
  const [whole, frac = ''] = str.split('.');
  const padded = frac.padEnd(USDC_DECIMALS, '0').slice(0, USDC_DECIMALS);
  return BigInt(whole + padded);
}

const NON_RETRYABLE_PATTERNS = [
  'Amount must be positive',
  'Payout exceeds max',
  'insufficient funds',
  'invalid account',
];

interface PayoutConfig {
  rpcUrl: string;
  wssUrl: string;
  keypairBytes: Uint8Array;
  maxPayoutUsdc: number;
  minReserveUsdc: number;
}

export class PayoutService {
  private constructor(
    private signer: KeyPairSigner,
    private rpc: Rpc<SolanaRpcApi>,
    private sendAndConfirm: ReturnType<typeof sendAndConfirmTransactionFactory>,
    private maxPayout: number,
    private minReserve: number,
  ) {}

  static async create(cfg: PayoutConfig): Promise<PayoutService> {
    const rpc = createSolanaRpc(cfg.rpcUrl);
    const rpcSub = createSolanaRpcSubscriptions(cfg.wssUrl);
    const signer = await createKeyPairSignerFromBytes(cfg.keypairBytes);
    const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions: rpcSub });
    return new PayoutService(signer, rpc, sendAndConfirm, cfg.maxPayoutUsdc, cfg.minReserveUsdc);
  }

  get walletAddress(): string {
    return this.signer.address;
  }

  async getUsdcBalance(): Promise<number> {
    const [ata] = await findAssociatedTokenPda({
      mint: USDC_MINT,
      owner: this.signer.address,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    try {
      const { value } = await this.rpc.getTokenAccountBalance(ata).send();
      return Number(value.uiAmountString ?? '0');
    } catch {
      return 0; // ATA doesn't exist = 0 balance
    }
  }

  async canAffordPayout(usdcAmount: number): Promise<boolean> {
    if (usdcAmount > this.maxPayout) return false;
    const balance = await this.getUsdcBalance();
    return balance >= usdcAmount + this.minReserve;
  }

  private async withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fn();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isRetryable = !NON_RETRYABLE_PATTERNS.some((p) => msg.includes(p));
        if (!isRetryable || attempt > maxRetries) throw err;
        const delayMs = 1000 * 2 ** (attempt - 1); // 1s, 2s, 4s
        console.warn(`Payout retry ${attempt}/${maxRetries} after ${delayMs}ms: ${msg}`);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  async sendUsdc(recipient: string, usdcAmount: number): Promise<string> {
    if (usdcAmount <= 0) throw new Error('Amount must be positive');
    if (usdcAmount > this.maxPayout) throw new Error(`Payout exceeds max: ${this.maxPayout} USDC`);

    const recipientAddr = address(recipient);
    const rawAmount = usdcToAtomicUnits(usdcAmount);

    const [senderAta] = await findAssociatedTokenPda({
      mint: USDC_MINT,
      owner: this.signer.address,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    const [recipientAta] = await findAssociatedTokenPda({
      mint: USDC_MINT,
      owner: recipientAddr,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    const createAtaIx = getCreateAssociatedTokenIdempotentInstruction({
      payer: this.signer,
      ata: recipientAta,
      owner: recipientAddr,
      mint: USDC_MINT,
    });

    const transferIx = getTransferCheckedInstruction({
      source: senderAta,
      mint: USDC_MINT,
      destination: recipientAta,
      authority: this.signer,
      amount: rawAmount,
      decimals: USDC_DECIMALS,
    });

    const { value: latestBlockhash } = await this.rpc.getLatestBlockhash().send();
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(this.signer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
      (m) => appendTransactionMessageInstructions([createAtaIx, transferIx], m),
    );

    const signedTx = await signTransactionMessageWithSigners(message);
    const signature = getSignatureFromTransaction(signedTx);
    // pipe() doesn't narrow the lifetime union — we know it's blockhash from above
    await this.withRetry(() =>
      this.sendAndConfirm(
        signedTx as Parameters<typeof this.sendAndConfirm>[0],
        { commitment: 'confirmed' },
      ),
    );
    return signature;
  }
}
