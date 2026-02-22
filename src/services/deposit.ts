import type { TransactionDB, Transaction } from '../db/sqlite.js';

// Narrow interface for what we actually use — real @solana/kit Rpc is cast to this at call site
interface SolanaRpc {
  getSignaturesForAddress(address: any, opts: any): {
    send(): Promise<Array<{ memo: string | null; signature: string }>>;
  };
  getTransaction(signature: any, opts: any): {
    send(): Promise<{
      meta: { preBalances: number[]; postBalances: number[] } | null;
    } | null>;
  };
}

interface DepositConfig {
  db: TransactionDB;
  rpc: SolanaRpc;
  treasuryAddress: string;
  onDeposit: (tx: Transaction, devnetSig: string) => void | Promise<void>;
  pollIntervalMs?: number;
  signatureFetchLimit?: number;
}

export class DepositDetector {
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(private cfg: DepositConfig) {}

  start() {
    const intervalMs = this.cfg.pollIntervalMs ?? 15_000;
    this.interval = setInterval(() => {
      this.poll().catch((err) => console.error('Deposit poll fatal:', err));
    }, intervalMs);
    console.log(`Deposit detector started (polling every ${intervalMs}ms)`);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async verifyDepositAmount(sig: string, expectedSol: number): Promise<boolean> {
    try {
      const txDetail = await this.cfg.rpc.getTransaction(sig, {
        maxSupportedTransactionVersion: 0,
      }).send();
      if (!txDetail?.meta) return false;
      const { preBalances, postBalances } = txDetail.meta;
      const lastIdx = postBalances.length - 1;
      const received = (postBalances[lastIdx] - preBalances[lastIdx]) / 1_000_000_000;
      return received >= expectedSol * 0.999;
    } catch {
      return false;
    }
  }

  async poll() {
    const pendingSells = this.cfg.db.findPendingSells();
    if (pendingSells.length === 0) return;

    try {
      const sigs = await this.cfg.rpc
        .getSignaturesForAddress(this.cfg.treasuryAddress, { limit: this.cfg.signatureFetchLimit ?? 50 })
        .send();

      for (const sig of sigs) {
        if (sig.memo && sig.memo.trim()) {
          // Solana RPC returns memo as "[byteLen] actualMemo" — strip prefix
          const rawMemo = sig.memo.trim();
          const cleanMemo = rawMemo.replace(/^\[\d+\]\s*/, '');
          if (!cleanMemo) continue;
          const matching = pendingSells.find((tx) => tx.memo && cleanMemo === tx.memo);
          if (matching) {
            const amountOk = await this.verifyDepositAmount(sig.signature, matching.sol_amount);
            if (amountOk) {
              await this.processDeposit(matching.id, sig.signature);
            } else {
              console.error(`Amount mismatch for sell ${matching.id} (sig: ${sig.signature})`);
              this.cfg.db.update(matching.id, { status: 'failed' });
            }
          }
        }
      }
    } catch (err) {
      console.error('Deposit poll error:', err);
    }
  }

  async processDeposit(txId: string, devnetSig: string) {
    const tx = this.cfg.db.atomicComplete(txId, devnetSig);
    if (!tx) return;
    await this.cfg.onDeposit(tx, devnetSig);
  }
}
