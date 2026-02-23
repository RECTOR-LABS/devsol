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
    // SQLite doesn't allow non-constant defaults in ALTER TABLE, so use a static default then backfill
    if (!columns.some(c => c.name === 'expires_at')) {
      this.db.exec("ALTER TABLE transactions ADD COLUMN expires_at TEXT NOT NULL DEFAULT ''");
      this.db.exec("UPDATE transactions SET expires_at = datetime(created_at, '+30 minutes') WHERE expires_at = ''");
    }

    // Migrate CHECK constraint to include 'expired' status (SQLite requires table rebuild)
    const tableInfo = this.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='transactions'").get() as { sql: string } | undefined;
    if (tableInfo && !tableInfo.sql.includes("'expired'")) {
      this.db.exec(`DROP TABLE IF EXISTS transactions_new`);
      this.db.exec(`
        CREATE TABLE transactions_new (
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
        INSERT INTO transactions_new (id, type, wallet, sol_amount, usdc_amount, mainnet_tx, devnet_tx, mainnet_payout_tx, memo, status, expires_at, created_at, updated_at)
          SELECT id, type, wallet, sol_amount, usdc_amount, mainnet_tx, devnet_tx, mainnet_payout_tx, memo, status,
            COALESCE(expires_at, datetime(created_at, '+30 minutes')),
            COALESCE(created_at, datetime('now')),
            COALESCE(updated_at, datetime('now'))
          FROM transactions;
        DROP TABLE transactions;
        ALTER TABLE transactions_new RENAME TO transactions;
        CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
        CREATE INDEX IF NOT EXISTS idx_transactions_memo ON transactions(memo);
      `);
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

  hasPendingSell(wallet: string, solAmount: number): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM transactions WHERE type = 'sell' AND status = 'pending' AND wallet = ? AND sol_amount = ? LIMIT 1")
      .get(wallet, solAmount);
    return !!row;
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

  countByStatus(): { pending: number; completed: number; failed: number; refunded: number; expired: number; total: number } {
    const rows = this.db
      .prepare('SELECT status, COUNT(*) as count FROM transactions GROUP BY status')
      .all() as Array<{ status: string; count: number }>;
    const counts = { pending: 0, completed: 0, failed: 0, refunded: 0, expired: 0, total: 0 };
    for (const row of rows) {
      counts[row.status as keyof typeof counts] = row.count;
      counts.total += row.count;
    }
    return counts;
  }

  getRecent(limit: number = 10): Array<{ id: string; type: string; wallet: string; sol_amount: number; usdc_amount: number; status: string; created_at: string }> {
    const rows = this.db
      .prepare('SELECT id, type, wallet, sol_amount, usdc_amount, status, created_at FROM transactions ORDER BY created_at DESC LIMIT ?')
      .all(limit) as Array<{ id: string; type: string; wallet: string; sol_amount: number; usdc_amount: number; status: string; created_at: string }>;
    return rows.map((r) => ({
      ...r,
      wallet: r.wallet.length > 8 ? `${r.wallet.slice(0, 4)}...${r.wallet.slice(-4)}` : r.wallet,
    }));
  }

  close() {
    this.db.close();
  }
}
