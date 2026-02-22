import { serve } from '@hono/node-server';
import { readFileSync } from 'fs';
import { address, createSolanaRpc } from '@solana/kit';
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { createApp } from './app.js';
import { TreasuryService } from './services/treasury.js';
import { PayoutService } from './services/payout.js';
import { DepositDetector } from './services/deposit.js';
import { handleDeposit } from './deposit-handler.js';
import { BuyDepositDetector } from './services/buy-deposit.js';
import { handleBuyDeposit } from './buy-deposit-handler.js';
import { config } from './config.js';
import { createLogger } from './logger.js';

const log = createLogger('server');

async function main() {
  // Devnet treasury (SOL)
  const keypairJson = readFileSync(config.treasuryKeypair, 'utf-8');
  const keypairBytes = new Uint8Array(JSON.parse(keypairJson));
  const treasury = await TreasuryService.create({
    rpcUrl: config.devnetRpc,
    wssUrl: config.devnetWss,
    keypairBytes,
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
    log.info(`Payout wallet: ${payout.walletAddress}`);
  } else {
    log.warn('No mainnet keypair configured — sell payouts disabled');
  }

  const { app, db } = createApp({ treasury, payout });

  // Deposit detector with payout callback
  const devnetRpc = createSolanaRpc(config.devnetRpc);
  const depositDetector = new DepositDetector({
    db,
    rpc: devnetRpc as any,
    treasuryAddress: treasury.address,
    onDeposit: (tx, sig) => handleDeposit(tx, sig, { payout, treasury, db }),
  });
  depositDetector.start();

  // Buy deposit detector (mainnet USDC)
  let buyDetector: BuyDepositDetector | undefined;
  if (payout) {
    const mainnetRpc = createSolanaRpc(config.mainnetRpc);
    const [usdcAta] = await findAssociatedTokenPda({
      mint: address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
      owner: address(payout.walletAddress),
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    buyDetector = new BuyDepositDetector({
      db,
      rpc: mainnetRpc as any,
      usdcAtaAddress: usdcAta.toString(),
      onDeposit: (tx, sig) => handleBuyDeposit(tx, sig, { treasury, payout, db }),
    });
    buyDetector.start();
  }

  // Expiry cleanup — run every 60s
  const expiryInterval = setInterval(() => {
    const count = db.expireStale();
    if (count > 0) log.info(`Expired ${count} stale pending transactions`);
  }, 60_000);

  // Graceful shutdown
  const shutdown = () => {
    clearInterval(expiryInterval);
    depositDetector.stop();
    buyDetector?.stop();
    db.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  serve({ fetch: app.fetch, port: config.port }, (info) => {
    log.info(`DevSOL running on http://localhost:${info.port}`);
    log.info(`Treasury: ${treasury.address}`);
  });
}

main().catch((err) => log.error({ err }, 'Fatal startup error'));
