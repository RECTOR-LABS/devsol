import { serve } from '@hono/node-server';
import { readFileSync } from 'fs';
import { createSolanaRpc } from '@solana/kit';
import { createApp } from './app.js';
import { TreasuryService } from './services/treasury.js';
import { X402Service } from './services/x402.js';
import { DepositDetector } from './services/deposit.js';
import { config } from './config.js';

async function main() {
  const keypairJson = readFileSync(config.treasuryKeypair, 'utf-8');
  const keypairBytes = new Uint8Array(JSON.parse(keypairJson));

  const treasury = await TreasuryService.create({
    rpcUrl: config.devnetRpc,
    wssUrl: config.devnetWss,
    keypairBytes,
  });

  const x402 = new X402Service({
    facilitator: {
      verify: async () => ({ valid: true }), // TODO: wire real facilitator
    },
    payTo: treasury.address,
    network: config.svmNetwork,
  });
  console.warn('WARNING: x402 facilitator verification is STUBBED — all payments accepted');

  const { app, db } = createApp({ treasury, x402 });

  const devnetRpc = createSolanaRpc(config.devnetRpc);
  const depositDetector = new DepositDetector({
    db,
    rpc: devnetRpc as any,
    treasuryAddress: treasury.address,
    onDeposit: async (tx, sig) => {
      console.log(`Deposit confirmed for sell ${tx.id}: ${sig}`);
      // TODO: trigger USDC payout on mainnet
    },
  });
  depositDetector.start();

  const shutdown = () => {
    depositDetector.stop();
    db.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`DevSOL running on http://localhost:${info.port}`);
    console.log(`Treasury: ${treasury.address}`);
  });
}

main().catch(console.error);
