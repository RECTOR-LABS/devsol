import type { TransactionDB, Transaction } from '../db/sqlite.js';

interface DepositConfig {
  db: TransactionDB;
  rpc: any; // Solana devnet RPC
  treasuryAddress: string;
  onDeposit: (tx: Transaction, devnetSig: string) => void | Promise<void>;
  pollIntervalMs?: number;
}

export class DepositDetector {
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(private cfg: DepositConfig) {}

  start() {
    const intervalMs = this.cfg.pollIntervalMs ?? 15_000;
    this.interval = setInterval(() => this.poll(), intervalMs);
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
        .getSignaturesForAddress(this.cfg.treasuryAddress, { limit: 50 })
        .send();

      for (const sig of sigs) {
        if (sig.memo) {
          const matching = pendingSells.find((tx) => sig.memo?.includes(tx.memo!));
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
    const tx = this.cfg.db.getById(txId);
    if (!tx || tx.status !== 'pending') return;

    this.cfg.db.update(txId, { status: 'completed', devnet_tx: devnetSig });
    await this.cfg.onDeposit(tx, devnetSig);
  }
}
