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
  memo: string | null;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
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
        memo        TEXT,
        status      TEXT NOT NULL DEFAULT 'pending'
                      CHECK(status IN ('pending', 'completed', 'failed', 'refunded')),
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
      CREATE INDEX IF NOT EXISTS idx_transactions_memo ON transactions(memo);
    `);
  }

  create(input: CreateTransactionInput): Transaction {
    const id = randomUUID();
    const stmt = this.db.prepare(`
      INSERT INTO transactions (id, type, wallet, sol_amount, usdc_amount, mainnet_tx, devnet_tx, memo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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

    if (input.status) {
      sets.push('status = ?');
      values.push(input.status);
    }
    if (input.mainnet_tx) {
      sets.push('mainnet_tx = ?');
      values.push(input.mainnet_tx);
    }
    if (input.devnet_tx) {
      sets.push('devnet_tx = ?');
      values.push(input.devnet_tx);
    }

    values.push(id);
    this.db.prepare(`UPDATE transactions SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  findPendingSells(): Transaction[] {
    return this.db
      .prepare("SELECT * FROM transactions WHERE type = 'sell' AND status = 'pending'")
      .all() as Transaction[];
  }

  findByMemo(memo: string): Transaction | null {
    const stmt = this.db.prepare('SELECT * FROM transactions WHERE memo = ?');
    return (stmt.get(memo) as Transaction) ?? null;
  }

  close() {
    this.db.close();
  }
}
