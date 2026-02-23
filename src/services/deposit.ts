import type { TransactionDB, Transaction } from '../db/sqlite.js';
import { createLogger } from '../logger.js';

const log = createLogger('sell-detector');

// Narrow interface for what we actually use — real @solana/kit Rpc is cast to this at call site
interface SolanaRpc {
  getSignaturesForAddress(address: any, opts: any): {
    send(): Promise<Array<{ memo: string | null; signature: string }>>;
  };
  getTransaction(signature: any, opts: any): {
    send(): Promise<{
      meta: { preBalances: number[]; postBalances: number[] } | null;
      transaction: { message: { accountKeys?: string[]; staticAccountKeys?: string[] } };
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
      this.poll().catch((err) => log.error({ err }, 'Deposit poll fatal'));
    }, intervalMs);
    log.info(`Deposit detector started (polling every ${intervalMs}ms)`);
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
      }).send() as any;
      if (!txDetail?.meta) {
        log.warn({ sig }, 'verifyDeposit: no meta');
        return false;
      }
      const { preBalances, postBalances } = txDetail.meta;
      // @solana/kit returns accountKeys (not staticAccountKeys)
      const msg = txDetail.transaction.message;
      const accountKeys: string[] = (msg.accountKeys ?? msg.staticAccountKeys ?? []).map(String);
      if (accountKeys.length === 0) {
        log.warn({ sig, messageKeys: Object.keys(msg) }, 'verifyDeposit: no account keys found');
        return false;
      }
      const treasuryIdx = accountKeys.findIndex(k => k === String(this.cfg.treasuryAddress));
      if (treasuryIdx === -1) {
        log.warn({ sig, accountKeys, treasury: this.cfg.treasuryAddress }, 'verifyDeposit: treasury not in accountKeys');
        return false;
      }
      const received = (postBalances[treasuryIdx] - preBalances[treasuryIdx]) / 1_000_000_000;
      return received >= expectedSol * 0.999;
    } catch (err) {
      log.warn({ sig, err }, 'verifyDeposit: exception');
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
        // Strategy 1: Match by memo (automatic flow — memo embedded in transaction)
        if (sig.memo && sig.memo.trim()) {
          const rawMemo = sig.memo.trim();
          const cleanMemo = rawMemo.replace(/^\[\d+\]\s*/, '');
          if (cleanMemo) {
            const matching = pendingSells.find((tx) => tx.memo && cleanMemo === tx.memo);
            if (matching) {
              const amountOk = await this.verifyDepositAmount(sig.signature, matching.sol_amount);
              if (amountOk) {
                await this.processDeposit(matching.id, sig.signature);
              } else {
                log.error(`Amount mismatch for sell ${matching.id} (sig: ${sig.signature})`);
                this.cfg.db.update(matching.id, { status: 'failed' });
              }
              continue;
            }
          }
        }

        // Strategy 2: Match by sender wallet + amount (manual fallback — no memo possible)
        await this.tryMatchByWallet(sig.signature, pendingSells);
      }
    } catch (err) {
      log.error({ err }, 'Deposit poll error');
    }
  }

  private async tryMatchByWallet(signature: string, pendingSells: Transaction[]) {
    try {
      const txDetail = await this.cfg.rpc.getTransaction(signature, {
        maxSupportedTransactionVersion: 0,
      }).send();
      if (!txDetail?.meta) return;

      const msg = (txDetail as any).transaction.message;
      const accountKeys: string[] = (msg.accountKeys ?? msg.staticAccountKeys ?? []).map(String);
      const treasuryIdx = accountKeys.findIndex(k => k === String(this.cfg.treasuryAddress));
      if (treasuryIdx === -1) return;

      const received = (txDetail.meta.postBalances[treasuryIdx] - txDetail.meta.preBalances[treasuryIdx]) / 1_000_000_000;
      // Sender is the first account (fee payer)
      const sender = accountKeys[0];

      const matching = pendingSells.find(
        (tx) => tx.wallet === sender && received >= tx.sol_amount * 0.999,
      );
      if (matching) {
        log.info({ txId: matching.id, sender, received }, 'Matched sell by wallet+amount');
        await this.processDeposit(matching.id, signature);
      }
    } catch {
      // Ignore — transaction might not be fetched yet
    }
  }

  async processDeposit(txId: string, devnetSig: string) {
    const tx = this.cfg.db.atomicComplete(txId, devnetSig);
    if (!tx) return;
    await this.cfg.onDeposit(tx, devnetSig);
  }
}
