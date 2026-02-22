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
} from '@solana/kit';
import {
  findAssociatedTokenPda,
  getTransferInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import { readFileSync } from 'fs';

const API = 'https://devsol.rectorspace.com';
const DEVNET_RPC = 'https://api.devnet.solana.com';
const MAINNET_RPC = process.env.MAINNET_RPC!;
const MAINNET_WSS = process.env.MAINNET_WSS!;
const TEST_KEYPAIR = readFileSync(
  `${process.env.HOME}/Documents/secret/devsol/test-user-keypair.json`,
  'utf-8',
);
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_DECIMALS = 6;
const AMOUNT_SOL = 0.1;

async function main() {
  console.log('=== DevSOL Buy Flow E2E Test ===\n');

  if (!MAINNET_RPC || !MAINNET_WSS) {
    console.error('MAINNET_RPC and MAINNET_WSS env vars required');
    process.exit(1);
  }

  // Step 1: POST /buy to create pending order
  console.log('Step 1: Creating buy order...');
  const buyRes = await fetch(`${API}/buy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wallet: 'BuyhetgWkEQL4fwEZvWLH4zuzTHLDuRGwRKEY21c2z1V',
      amount_sol: AMOUNT_SOL,
    }),
  });
  const buyData = await buyRes.json();
  console.log('Buy response:', JSON.stringify(buyData, null, 2));

  if (buyData.status !== 'pending') {
    console.error('FAIL: Expected pending status');
    process.exit(1);
  }

  const { deposit_address, memo, transaction_id, usdc_cost } = buyData;
  console.log(`\nDeposit USDC to: ${deposit_address}`);
  console.log(`Memo: ${memo}`);
  console.log(`USDC cost: ${usdc_cost}`);
  console.log(`TX ID: ${transaction_id}\n`);

  // Step 2: Send mainnet USDC with memo
  console.log('Step 2: Sending mainnet USDC with memo...');
  const rpc = createSolanaRpc(MAINNET_RPC);
  const rpcSub = createSolanaRpcSubscriptions(MAINNET_WSS);
  const signer = await createKeyPairSignerFromBytes(
    new Uint8Array(JSON.parse(TEST_KEYPAIR)),
  );
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions: rpcSub });

  // Derive ATAs
  const [sourceAta] = await findAssociatedTokenPda({
    mint: address(USDC_MINT),
    owner: signer.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const [destAta] = await findAssociatedTokenPda({
    mint: address(USDC_MINT),
    owner: address(deposit_address),
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  const atomicAmount = BigInt(Math.round(usdc_cost * 10 ** USDC_DECIMALS));
  const transferIx = getTransferInstruction({
    source: sourceAta,
    destination: destAta,
    authority: signer,
    amount: atomicAmount,
  });

  const { getAddMemoInstruction } = await import('@solana-program/memo');
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
  console.log('Mainnet USDC transfer confirmed!\n');

  // Step 3: Check devnet balance before delivery
  console.log('Step 3: Checking devnet SOL balance...');
  const devnetRpc = createSolanaRpc(DEVNET_RPC);
  const balanceBefore = await devnetRpc
    .getBalance('BuyhetgWkEQL4fwEZvWLH4zuzTHLDuRGwRKEY21c2z1V' as any)
    .send();
  const solBefore = Number(balanceBefore.value) / 1_000_000_000;
  console.log(`  Devnet SOL balance: ${solBefore}`);

  // Step 4: Poll for deposit detection + devnet SOL delivery
  console.log('\nStep 4: Waiting for deposit detection and SOL delivery...');
  const maxWait = 120_000;
  const pollInterval = 5_000;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    const txRes = await fetch(`${API}/tx/${transaction_id}`);
    const txData = await txRes.json();
    console.log(`  Status: ${txData.status} (${Math.round((Date.now() - start) / 1000)}s elapsed)`);

    if (txData.status === 'completed' && txData.devnet_tx) {
      // Verify devnet SOL arrived
      await new Promise((r) => setTimeout(r, 3_000));
      const balanceAfter = await devnetRpc
        .getBalance('BuyhetgWkEQL4fwEZvWLH4zuzTHLDuRGwRKEY21c2z1V' as any)
        .send();
      const solAfter = Number(balanceAfter.value) / 1_000_000_000;
      const diff = solAfter - solBefore;

      console.log('\n=== SUCCESS ===');
      console.log(`Buy completed!`);
      console.log(`  TX ID: ${txData.id}`);
      console.log(`  SOL received: ${txData.sol_amount}`);
      console.log(`  USDC paid: ${txData.usdc_amount}`);
      console.log(`  Mainnet USDC TX: ${txData.mainnet_tx}`);
      console.log(`  Devnet SOL TX: ${txData.devnet_tx}`);
      console.log(`  Devnet balance change: +${diff.toFixed(4)} SOL`);
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
