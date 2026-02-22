import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

export interface Transaction {
  id: string;
  type: 'buy' | 'sell';
  wallet: string;
  sol_amount: number;
  usdc_amount: number;
  mainnet_tx: string | null;
  devnet_tx: string | null;
  mainnet_payout_tx: string | null;
  memo: string | null;
  status: 'pending' | 'completed' | 'failed' | 'refunded' | 'expired';
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface CreateTransactionInput {
  type: 'buy' | 'sell';
  wallet: string;
  sol_amount: number;
  usdc_amount: number;
  mainnet_tx?: string;
  devnet_tx?: string;
  memo?: string;
}

export interface UpdateTransactionInput {
  status?: Transaction['status'];
  mainnet_tx?: string;
  devnet_tx?: string;
  mainnet_payout_tx?: string;
}

export class TransactionDB {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS transactions (
        id          TEXT PRIMARY KEY,
        type        TEXT NOT NULL CHECK(type IN ('buy', 'sell')),
        wallet      TEXT NOT NULL,
        sol_amount  REAL NOT NULL,
        usdc_amount REAL NOT NULL,
        mainnet_tx  TEXT UNIQUE,
        devnet_tx   TEXT,
        mainnet_payout_tx TEXT,
        memo        TEXT,
        status      TEXT NOT NULL DEFAULT 'pending'
                      CHECK(status IN ('pending', 'completed', 'failed', 'refunded', 'expired')),
        expires_at  TEXT NOT NULL DEFAULT (datetime('now', '+30 minutes')),
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
      CREATE INDEX IF NOT EXISTS idx_transactions_memo ON transactions(memo);
    `);

    // Add mainnet_payout_tx column if it doesn't exist (migration for existing DBs)
    const columns = this.db.pragma('table_info(transactions)') as Array<{ name: string }>;
    if (!columns.some(c => c.name === 'mainnet_payout_tx')) {
      this.db.exec('ALTER TABLE transactions ADD COLUMN mainnet_payout_tx TEXT');
    }

    // Add expires_at column if it doesn't exist (migration for existing DBs)
    if (!columns.some(c => c.name === 'expires_at')) {
      this.db.exec("ALTER TABLE transactions ADD COLUMN expires_at TEXT DEFAULT (datetime('now', '+30 minutes'))");
    }
  }

  create(input: CreateTransactionInput): Transaction {
    const id = randomUUID();
    const stmt = this.db.prepare(`
      INSERT INTO transactions (id, type, wallet, sol_amount, usdc_amount, mainnet_tx, devnet_tx, memo, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+30 minutes'))
    `);
    stmt.run(
      id,
      input.type,
      input.wallet,
      input.sol_amount,
      input.usdc_amount,
      input.mainnet_tx ?? null,
      input.devnet_tx ?? null,
      input.memo ?? null,
    );
    return this.getById(id)!;
  }

  getById(id: string): Transaction | null {
    const stmt = this.db.prepare('SELECT * FROM transactions WHERE id = ?');
    return (stmt.get(id) as Transaction) ?? null;
  }

  update(id: string, input: UpdateTransactionInput): void {
    const sets: string[] = ["updated_at = datetime('now')"];
    const values: unknown[] = [];

    if (input.status !== undefined) {
      sets.push('status = ?');
      values.push(input.status);
    }
    if (input.mainnet_tx !== undefined) {
      sets.push('mainnet_tx = ?');
      values.push(input.mainnet_tx);
    }
    if (input.devnet_tx !== undefined) {
      sets.push('devnet_tx = ?');
      values.push(input.devnet_tx);
    }
    if (input.mainnet_payout_tx !== undefined) {
      sets.push('mainnet_payout_tx = ?');
      values.push(input.mainnet_payout_tx);
    }

    values.push(id);
    const result = this.db.prepare(`UPDATE transactions SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    if (result.changes === 0) {
      throw new Error(`Transaction not found: ${id}`);
    }
  }

  atomicComplete(id: string, devnetSig: string): Transaction | null {
    const result = this.db.prepare(
      "UPDATE transactions SET status = 'completed', devnet_tx = ?, updated_at = datetime('now') WHERE id = ? AND status = 'pending'"
    ).run(devnetSig, id);
    if (result.changes === 0) return null;
    return this.getById(id);
  }

  findPendingSells(): Transaction[] {
    return this.db
      .prepare("SELECT * FROM transactions WHERE type = 'sell' AND status = 'pending'")
      .all() as Transaction[];
  }

  findPendingBuys(): Transaction[] {
    return this.db
      .prepare("SELECT * FROM transactions WHERE type = 'buy' AND status = 'pending'")
      .all() as Transaction[];
  }

  atomicCompleteBuy(id: string, mainnetSig: string): Transaction | null {
    const result = this.db.prepare(
      "UPDATE transactions SET status = 'completed', mainnet_tx = ?, updated_at = datetime('now') WHERE id = ? AND status = 'pending'"
    ).run(mainnetSig, id);
    if (result.changes === 0) return null;
    return this.getById(id);
  }

  findByMemo(memo: string): Transaction | null {
    const stmt = this.db.prepare('SELECT * FROM transactions WHERE memo = ?');
    return (stmt.get(memo) as Transaction) ?? null;
  }

  expireStale(): number {
    const result = this.db.prepare(
      "UPDATE transactions SET status = 'expired', updated_at = datetime('now') WHERE status = 'pending' AND expires_at <= datetime('now')"
    ).run();
    return result.changes;
  }

  close() {
    this.db.close();
  }
}
