import {
  createSolanaRpc,
  createKeyPairSignerFromBytes,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  getSignatureFromTransaction,
  sendAndConfirmTransactionFactory,
  createSolanaRpcSubscriptions,
  address,
  lamports,
} from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import { readFileSync } from 'fs';

const API = 'https://devsol.rectorspace.com';
const DEVNET_RPC = 'https://api.devnet.solana.com';
const DEVNET_WSS = 'wss://api.devnet.solana.com';
const TEST_KEYPAIR = readFileSync(
  `${process.env.HOME}/Documents/secret/devsol/test-user-keypair.json`,
  'utf-8',
);
const AMOUNT_SOL = 0.1;

async function main() {
  console.log('=== DevSOL Sell Flow E2E Test ===\n');

  // Step 1: POST /sell
  console.log('Step 1: Creating sell order...');
  const sellRes = await fetch(`${API}/sell`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wallet: 'BuyhetgWkEQL4fwEZvWLH4zuzTHLDuRGwRKEY21c2z1V',
      amount_sol: AMOUNT_SOL,
    }),
  });
  const sellData = await sellRes.json();
  console.log('Sell response:', JSON.stringify(sellData, null, 2));

  if (sellData.status !== 'pending') {
    console.error('FAIL: Expected pending status');
    process.exit(1);
  }

  const { deposit_address, memo, transaction_id } = sellData;
  console.log(`\nDeposit to: ${deposit_address}`);
  console.log(`Memo: ${memo}`);
  console.log(`TX ID: ${transaction_id}\n`);

  // Step 2: Send devnet SOL with memo
  console.log('Step 2: Sending devnet SOL with memo...');
  const rpc = createSolanaRpc(DEVNET_RPC);
  const rpcSub = createSolanaRpcSubscriptions(DEVNET_WSS);
  const signer = await createKeyPairSignerFromBytes(
    new Uint8Array(JSON.parse(TEST_KEYPAIR)),
  );
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions: rpcSub });

  // Build memo + transfer transaction
  const { getAddMemoInstruction } = await import('@solana-program/memo');
  const transferIx = getTransferSolInstruction({
    source: signer,
    destination: address(deposit_address),
    amount: lamports(BigInt(AMOUNT_SOL * 1_000_000_000)),
  });
  const memoIx = getAddMemoInstruction({ memo });

  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions([transferIx, memoIx], m),
  );

  const signedTx = await signTransactionMessageWithSigners(message);
  const sig = getSignatureFromTransaction(signedTx);
  console.log(`Transaction signature: ${sig}`);

  await sendAndConfirm(
    signedTx as Parameters<typeof sendAndConfirm>[0],
    { commitment: 'confirmed' },
  );
  console.log('Devnet SOL transfer confirmed!\n');

  // Step 3: Poll for deposit detection + USDC payout
  console.log('Step 3: Waiting for deposit detection and USDC payout...');
  const maxWait = 120_000; // 2 minutes
  const pollInterval = 5_000;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    const txRes = await fetch(`${API}/tx/${transaction_id}`);
    const txData = await txRes.json();
    console.log(`  Status: ${txData.status} (${Math.round((Date.now() - start) / 1000)}s elapsed)`);

    if (txData.status === 'completed' && txData.mainnet_payout_tx) {
      console.log('\n=== SUCCESS ===');
      console.log(`Sell completed!`);
      console.log(`  TX ID: ${txData.id}`);
      console.log(`  SOL sent: ${txData.sol_amount}`);
      console.log(`  USDC received: ${txData.usdc_amount}`);
      console.log(`  Devnet TX: ${txData.devnet_tx}`);
      console.log(`  Mainnet payout TX: ${txData.mainnet_payout_tx}`);
      process.exit(0);
    }

    if (txData.status === 'refunded' || txData.status === 'failed') {
      console.error(`\nFAIL: Transaction ${txData.status}`);
      console.error(JSON.stringify(txData, null, 2));
      process.exit(1);
    }

    await new Promise((r) => setTimeout(r, pollInterval));
  }

  console.error('\nTIMEOUT: Deposit not detected within 2 minutes');
  process.exit(1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
