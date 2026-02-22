import { serve } from '@hono/node-server';
import { readFileSync } from 'fs';
import { createSolanaRpc } from '@solana/kit';
import { HTTPFacilitatorClient } from '@x402/core/http';
import { createApp } from './app.js';
import { TreasuryService } from './services/treasury.js';
import { X402Service } from './services/x402.js';
import { PayoutService } from './services/payout.js';
import { DepositDetector } from './services/deposit.js';
import { handleDeposit } from './deposit-handler.js';
import { config } from './config.js';

async function main() {
  // Devnet treasury (SOL)
  const keypairJson = readFileSync(config.treasuryKeypair, 'utf-8');
  const keypairBytes = new Uint8Array(JSON.parse(keypairJson));
  const treasury = await TreasuryService.create({
    rpcUrl: config.devnetRpc,
    wssUrl: config.devnetWss,
    keypairBytes,
  });

  // x402 facilitator (real)
  const facilitator = new HTTPFacilitatorClient({ url: config.facilitatorUrl });

  // Mainnet payout (USDC) — optional, enables sell flow
  let payout: PayoutService | undefined;
  if (config.mainnetKeypair) {
    const mainnetJson = readFileSync(config.mainnetKeypair, 'utf-8');
    const mainnetBytes = new Uint8Array(JSON.parse(mainnetJson));
    payout = await PayoutService.create({
      rpcUrl: config.mainnetRpc,
      wssUrl: config.mainnetWss,
      keypairBytes: mainnetBytes,
      maxPayoutUsdc: config.maxPayoutUsdc,
      minReserveUsdc: config.minReserveUsdc,
    });
    console.log(`Payout wallet: ${payout.walletAddress}`);
  } else {
    console.warn('WARNING: No mainnet keypair configured — sell payouts disabled');
  }

  // x402 payTo: mainnet payout wallet if available, else devnet treasury
  const x402 = new X402Service({
    facilitator,
    payTo: payout?.walletAddress ?? treasury.address,
    network: config.svmNetwork,
  });

  const { app, db } = createApp({ treasury, x402, payout });

  // Deposit detector with payout callback
  const devnetRpc = createSolanaRpc(config.devnetRpc);
  const depositDetector = new DepositDetector({
    db,
    rpc: devnetRpc as any,
    treasuryAddress: treasury.address,
    onDeposit: (tx, sig) => handleDeposit(tx, sig, { payout, treasury, db }),
  });
  depositDetector.start();

  // Graceful shutdown
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
