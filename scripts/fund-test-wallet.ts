import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createKeyPairSignerFromBytes,
  address,
  lamports,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  getSignatureFromTransaction,
  sendAndConfirmTransactionFactory,
} from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import {
  findAssociatedTokenPda,
  getTransferCheckedInstruction,
  getCreateAssociatedTokenIdempotentInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import { readFileSync } from 'fs';

const MAINNET_RPC = 'https://mainnet.helius-rpc.com/?api-key=142fb48a-aa24-4083-99c8-249df5400b30';
const MAINNET_WSS = 'wss://mainnet.helius-rpc.com/?api-key=142fb48a-aa24-4083-99c8-249df5400b30';
const PAYOUT_KEYPAIR = readFileSync(
  `${process.env.HOME}/Documents/secret/devsol/mainnet-payout-keypair.json`,
  'utf-8',
);
const TEST_WALLET = 'BuyhetgWkEQL4fwEZvWLH4zuzTHLDuRGwRKEY21c2z1V';
const USDC_MINT = address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const USDC_DECIMALS = 6;
const SOL_TO_SEND = 0.005; // enough for gas
const USDC_TO_SEND = 0.2;  // enough for a 0.1 SOL buy (0.105 USDC)

async function main() {
  console.log('=== Fund Test Wallet on Mainnet ===\n');

  const rpc = createSolanaRpc(MAINNET_RPC);
  const rpcSub = createSolanaRpcSubscriptions(MAINNET_WSS);
  const signer = await createKeyPairSignerFromBytes(
    new Uint8Array(JSON.parse(PAYOUT_KEYPAIR)),
  );
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions: rpcSub });
  const recipient = address(TEST_WALLET);

  console.log(`From: ${signer.address}`);
  console.log(`To:   ${TEST_WALLET}\n`);

  // Step 1: Send SOL for gas
  console.log(`Step 1: Sending ${SOL_TO_SEND} SOL for gas...`);
  const transferSolIx = getTransferSolInstruction({
    source: signer,
    destination: recipient,
    amount: lamports(BigInt(Math.round(SOL_TO_SEND * 1_000_000_000))),
  });

  const { value: bh1 } = await rpc.getLatestBlockhash().send();
  const msg1 = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(bh1, m),
    (m) => appendTransactionMessageInstructions([transferSolIx], m),
  );
  const signed1 = await signTransactionMessageWithSigners(msg1);
  const sig1 = getSignatureFromTransaction(signed1);
  await sendAndConfirm(signed1 as Parameters<typeof sendAndConfirm>[0], { commitment: 'confirmed' });
  console.log(`  SOL sent: ${sig1}\n`);

  // Step 2: Send USDC (create ATA if needed)
  console.log(`Step 2: Sending ${USDC_TO_SEND} USDC...`);
  const [senderAta] = await findAssociatedTokenPda({
    mint: USDC_MINT,
    owner: signer.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const [recipientAta] = await findAssociatedTokenPda({
    mint: USDC_MINT,
    owner: recipient,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  const createAtaIx = getCreateAssociatedTokenIdempotentInstruction({
    payer: signer,
    ata: recipientAta,
    owner: recipient,
    mint: USDC_MINT,
  });
  const transferUsdcIx = getTransferCheckedInstruction({
    source: senderAta,
    mint: USDC_MINT,
    destination: recipientAta,
    authority: signer,
    amount: BigInt(Math.round(USDC_TO_SEND * 10 ** USDC_DECIMALS)),
    decimals: USDC_DECIMALS,
  });

  const { value: bh2 } = await rpc.getLatestBlockhash().send();
  const msg2 = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(bh2, m),
    (m) => appendTransactionMessageInstructions([createAtaIx, transferUsdcIx], m),
  );
  const signed2 = await signTransactionMessageWithSigners(msg2);
  const sig2 = getSignatureFromTransaction(signed2);
  await sendAndConfirm(signed2 as Parameters<typeof sendAndConfirm>[0], { commitment: 'confirmed' });
  console.log(`  USDC sent: ${sig2}\n`);

  console.log('=== Done ===');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
