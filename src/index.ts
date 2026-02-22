import { serve } from '@hono/node-server';
import { readFileSync } from 'fs';
import { createSolanaRpc } from '@solana/kit';
import { HTTPFacilitatorClient } from '@x402/core/http';
import { createApp } from './app.js';
import { TreasuryService } from './services/treasury.js';
import { X402Service } from './services/x402.js';
import { PayoutService } from './services/payout.js';
import { DepositDetector } from './services/deposit.js';
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
  const x402 = new X402Service({
    facilitator,
    payTo: treasury.address,
    network: config.svmNetwork,
  });

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

  const { app, db } = createApp({ treasury, x402, payout });

  // Deposit detector with payout callback
  const devnetRpc = createSolanaRpc(config.devnetRpc);
  const depositDetector = new DepositDetector({
    db,
    rpc: devnetRpc as any,
    treasuryAddress: treasury.address,
    onDeposit: async (tx, devnetSig) => {
      console.log(`Deposit confirmed for sell ${tx.id}: ${devnetSig}`);
      if (!payout) {
        console.warn(`No payout service — sell ${tx.id} completed without USDC payout`);
        return;
      }
      try {
        const mainnetSig = await payout.sendUsdc(tx.wallet, tx.usdc_amount);
        db.update(tx.id, { mainnet_payout_tx: mainnetSig });
        console.log(`USDC payout sent for sell ${tx.id}: ${mainnetSig}`);
      } catch (err) {
        console.error(`USDC payout failed for sell ${tx.id}:`, err);
        // Refund devnet SOL
        try {
          const refundSig = await treasury.sendSol(tx.wallet, tx.sol_amount);
          db.update(tx.id, { status: 'refunded', devnet_tx: refundSig });
          console.log(`Refunded ${tx.sol_amount} SOL to ${tx.wallet}: ${refundSig}`);
        } catch (refundErr) {
          console.error(`CRITICAL: Refund also failed for sell ${tx.id}:`, refundErr);
          db.update(tx.id, { status: 'failed' });
        }
      }
    },
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
