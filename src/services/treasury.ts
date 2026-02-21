import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  sendAndConfirmTransactionFactory,
  createKeyPairSignerFromBytes,
  address,
  lamports,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  signTransactionMessageWithSigners,
  getSignatureFromTransaction,
  type KeyPairSigner,
  type Rpc,
  type SolanaRpcApi,
} from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';

const LAMPORTS_PER_SOL = 1_000_000_000n;

interface TreasuryConfig {
  rpcUrl: string;
  wssUrl: string;
  keypairBytes: Uint8Array;
}

export class TreasuryService {
  private constructor(
    private signer: KeyPairSigner,
    private rpc: Rpc<SolanaRpcApi>,
    private sendAndConfirm: ReturnType<typeof sendAndConfirmTransactionFactory>,
  ) {}

  static async create(cfg: TreasuryConfig): Promise<TreasuryService> {
    const rpc = createSolanaRpc(cfg.rpcUrl);
    const rpcSub = createSolanaRpcSubscriptions(cfg.wssUrl);
    const signer = await createKeyPairSignerFromBytes(cfg.keypairBytes);
    const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions: rpcSub });
    return new TreasuryService(signer, rpc, sendAndConfirm);
  }

  get address(): string {
    return this.signer.address;
  }

  async getBalance(): Promise<number> {
    const { value } = await this.rpc.getBalance(this.signer.address).send();
    return Number(value) / Number(LAMPORTS_PER_SOL);
  }

  async sendSol(recipient: string, solAmount: number): Promise<string> {
    if (solAmount <= 0) throw new Error('Amount must be positive');

    const lamportAmount = lamports(BigInt(Math.round(solAmount * Number(LAMPORTS_PER_SOL))));
    const { value: latestBlockhash } = await this.rpc.getLatestBlockhash().send();

    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(this.signer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
      (m) =>
        appendTransactionMessageInstruction(
          getTransferSolInstruction({
            source: this.signer,
            destination: address(recipient),
            amount: lamportAmount,
          }),
          m,
        ),
    );

    const signedTx = await signTransactionMessageWithSigners(message);
    const signature = getSignatureFromTransaction(signedTx);
    await this.sendAndConfirm(signedTx, { commitment: 'confirmed' });
    return signature;
  }
}
