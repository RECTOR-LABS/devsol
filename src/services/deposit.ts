import type { TransactionDB, Transaction } from '../db/sqlite.js';

// Narrow interface for what we actually use — real @solana/kit Rpc is cast to this at call site
interface SolanaRpc {
  getSignaturesForAddress(address: any, opts: any): {
    send(): Promise<Array<{ memo: string | null; signature: string }>>;
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

  async poll() {
    const pendingSells = this.cfg.db.findPendingSells();
    if (pendingSells.length === 0) return;

    try {
      const sigs = await this.cfg.rpc
        .getSignaturesForAddress(this.cfg.treasuryAddress, { limit: this.cfg.signatureFetchLimit ?? 50 })
        .send();

      for (const sig of sigs) {
        if (sig.memo && sig.memo.trim()) {
          const trimmedMemo = sig.memo.trim();
          const matching = pendingSells.find((tx) => tx.memo && trimmedMemo === tx.memo);
          if (matching) {
            await this.processDeposit(matching.id, sig.signature);
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
