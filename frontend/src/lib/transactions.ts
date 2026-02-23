import { Buffer } from 'buffer';
import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';

const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const USDC_DECIMALS = 6;
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

function memoInstruction(memo: string, signer: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    keys: [{ pubkey: signer, isSigner: true, isWritable: false }],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(memo, 'utf-8'),
  });
}

/**
 * Build a mainnet USDC transfer transaction for the buy flow.
 * User sends USDC to the payout wallet with a memo for order matching.
 */
export async function buildBuyTransaction(
  connection: Connection,
  sender: PublicKey,
  recipient: string,
  usdcAmount: number,
  memo: string,
): Promise<Transaction> {
  const recipientPubkey = new PublicKey(recipient);
  const senderAta = getAssociatedTokenAddressSync(USDC_MINT, sender);
  const recipientAta = getAssociatedTokenAddressSync(USDC_MINT, recipientPubkey);
  const atomicAmount = BigInt(Math.round(usdcAmount * 10 ** USDC_DECIMALS));

  const tx = new Transaction();
  tx.add(
    createTransferCheckedInstruction(
      senderAta,
      USDC_MINT,
      recipientAta,
      sender,
      atomicAmount,
      USDC_DECIMALS,
    ),
  );
  tx.add(memoInstruction(memo, sender));

  tx.feePayer = sender;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  return tx;
}

const DEVNET_RPC = import.meta.env.VITE_DEVNET_RPC || 'https://api.devnet.solana.com';

/**
 * Build a devnet SOL transfer transaction for the sell flow.
 * User sends devnet SOL to the treasury with a memo for order matching.
 * Returns both the transaction and devnet connection since the wallet adapter
 * is mainnet-only — we sign with the wallet then submit to devnet ourselves.
 */
export async function buildSellTransaction(
  sender: PublicKey,
  recipient: string,
  solAmount: number,
  memo: string,
): Promise<{ transaction: Transaction; devnetConnection: Connection }> {
  const devnetConnection = new Connection(DEVNET_RPC, 'confirmed');
  const recipientPubkey = new PublicKey(recipient);
  const lamports = Math.round(solAmount * 1e9);

  const tx = new Transaction();
  tx.add(SystemProgram.transfer({ fromPubkey: sender, toPubkey: recipientPubkey, lamports }));
  tx.add(memoInstruction(memo, sender));

  tx.feePayer = sender;
  tx.recentBlockhash = (await devnetConnection.getLatestBlockhash()).blockhash;
  return { transaction: tx, devnetConnection };
}
