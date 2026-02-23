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

function usdcToAtomic(amount: number): bigint {
  const str = amount.toFixed(USDC_DECIMALS);
  const [whole, frac = ''] = str.split('.');
  const padded = frac.padEnd(USDC_DECIMALS, '0').slice(0, USDC_DECIMALS);
  return BigInt(whole + padded);
}

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
  const atomicAmount = usdcToAtomic(usdcAmount);

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

let devnetConnection: Connection | null = null;
function getDevnetConnection(): Connection {
  if (!devnetConnection) {
    devnetConnection = new Connection(DEVNET_RPC, 'confirmed');
  }
  return devnetConnection;
}

/**
 * Build a devnet SOL transfer transaction for the sell flow.
 * User sends devnet SOL to the treasury with a memo for order matching.
 * Returns the transaction, devnet connection, and lastValidBlockHeight for confirmation.
 * The wallet adapter is mainnet-only — we sign with the wallet then submit to devnet ourselves.
 */
export async function buildSellTransaction(
  sender: PublicKey,
  recipient: string,
  solAmount: number,
  memo: string,
): Promise<{ transaction: Transaction; devnetConnection: Connection; lastValidBlockHeight: number }> {
  const conn = getDevnetConnection();
  const recipientPubkey = new PublicKey(recipient);
  const lamports = Math.round(solAmount * 1e9);

  const tx = new Transaction();
  tx.add(SystemProgram.transfer({ fromPubkey: sender, toPubkey: recipientPubkey, lamports }));
  tx.add(memoInstruction(memo, sender));

  tx.feePayer = sender;
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  return { transaction: tx, devnetConnection: conn, lastValidBlockHeight };
}
