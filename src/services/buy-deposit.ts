import type { TransactionDB, Transaction } from '../db/sqlite.js';
import { createLogger } from '../logger.js';

const log = createLogger('buy-detector');

// Narrow interface for what we actually use — real @solana/kit Rpc is cast to this at call site
interface SolanaRpc {
  getSignaturesForAddress(address: any, opts: any): {
    send(): Promise<Array<{ memo: string | null; signature: string }>>;
  };
  getTransaction(signature: any, opts: any): {
    send(): Promise<{
      meta: {
        preTokenBalances: Array<{ mint: string; uiTokenAmount: { amount: string } }>;
        postTokenBalances: Array<{ mint: string; uiTokenAmount: { amount: string } }>;
      } | null;
    } | null>;
  };
}

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

interface BuyDepositConfig {
  db: TransactionDB;
  rpc: SolanaRpc;
  usdcAtaAddress: string;
  onDeposit: (tx: Transaction, mainnetSig: string) => void | Promise<void>;
  pollIntervalMs?: number;
  signatureFetchLimit?: number;
}

export class BuyDepositDetector {
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(private cfg: BuyDepositConfig) {}

  start() {
    const intervalMs = this.cfg.pollIntervalMs ?? 15_000;
    this.interval = setInterval(() => {
      this.poll().catch((err) => log.error({ err }, 'Buy deposit poll fatal'));
    }, intervalMs);
    log.info(`Buy deposit detector started (polling every ${intervalMs}ms)`);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async verifyUsdcAmount(sig: string, expectedUsdc: number): Promise<boolean> {
    try {
      const txDetail = await this.cfg.rpc.getTransaction(sig, {
        maxSupportedTransactionVersion: 0,
      }).send();
      if (!txDetail?.meta) return false;
      const { preTokenBalances, postTokenBalances } = txDetail.meta;
      const preBal = BigInt(preTokenBalances.find(b => b.mint === USDC_MINT)?.uiTokenAmount.amount ?? '0');
      const postBal = BigInt(postTokenBalances.find(b => b.mint === USDC_MINT)?.uiTokenAmount.amount ?? '0');
      const received = postBal - preBal;
      // Compare in atomic units (USDC has 6 decimals)
      const expectedAtomic = BigInt(Math.round(expectedUsdc * 1_000_000));
      return received >= expectedAtomic;
    } catch {
      return false;
    }
  }

  async poll() {
    const pendingBuys = this.cfg.db.findPendingBuys();
    if (pendingBuys.length === 0) return;

    try {
      const sigs = await this.cfg.rpc
        .getSignaturesForAddress(this.cfg.usdcAtaAddress, { limit: this.cfg.signatureFetchLimit ?? 50 })
        .send();

      for (const sig of sigs) {
        if (sig.memo && sig.memo.trim()) {
          // Solana RPC returns memo as "[byteLen] actualMemo" — strip prefix
          const rawMemo = sig.memo.trim();
          const cleanMemo = rawMemo.replace(/^\[\d+\]\s*/, '');
          if (!cleanMemo) continue;
          const matching = pendingBuys.find((tx) => tx.memo && cleanMemo === tx.memo);
          if (matching) {
            const amountOk = await this.verifyUsdcAmount(sig.signature, matching.usdc_amount);
            if (amountOk) {
              await this.processDeposit(matching.id, sig.signature);
            } else {
              log.error(`Amount mismatch for buy ${matching.id} (sig: ${sig.signature})`);
              this.cfg.db.update(matching.id, { status: 'failed', mainnet_tx: sig.signature });
            }
          }
        }
      }
    } catch (err) {
      log.error({ err }, 'Buy deposit poll error');
    }
  }

  async processDeposit(txId: string, mainnetSig: string) {
    const tx = this.cfg.db.atomicCompleteBuy(txId, mainnetSig);
    if (!tx) return;
    await this.cfg.onDeposit(tx, mainnetSig);
  }
}
