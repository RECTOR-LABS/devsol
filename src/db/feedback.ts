import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

export interface Feedback {
  id: string;
  author: string | null;
  content: string;
  votes: number;
  ip_hash: string;
  created_at: string;
}

interface CreateInput {
  content: string;
  author?: string;
  ipHash: string;
}

export class FeedbackDB {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS feedback (
        id         TEXT PRIMARY KEY,
        author     TEXT,
        content    TEXT NOT NULL,
        votes      INTEGER NOT NULL DEFAULT 0,
        ip_hash    TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS feedback_votes (
        feedback_id TEXT NOT NULL,
        ip_hash     TEXT NOT NULL,
        PRIMARY KEY (feedback_id, ip_hash)
      );
    `);
  }

  create(input: CreateInput): Feedback {
    const id = randomUUID();
    this.db.prepare(
      'INSERT INTO feedback (id, author, content, ip_hash) VALUES (?, ?, ?, ?)'
    ).run(id, input.author ?? null, input.content, input.ipHash);
    return this.db.prepare('SELECT * FROM feedback WHERE id = ?').get(id) as Feedback;
  }

  listAll(): Feedback[] {
    return this.db
      .prepare('SELECT * FROM feedback ORDER BY votes DESC, created_at DESC')
      .all() as Feedback[];
  }

  vote(feedbackId: string, ipHash: string): boolean {
    try {
      this.db.prepare(
        'INSERT INTO feedback_votes (feedback_id, ip_hash) VALUES (?, ?)'
      ).run(feedbackId, ipHash);
      this.db.prepare(
        'UPDATE feedback SET votes = votes + 1 WHERE id = ?'
      ).run(feedbackId);
      return true;
    } catch {
      return false;
    }
  }

  countByIp(ipHash: string): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as count FROM feedback WHERE ip_hash = ?'
    ).get(ipHash) as { count: number };
    return row.count;
  }

  countVotesByIp(ipHash: string): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as count FROM feedback_votes WHERE ip_hash = ?'
    ).get(ipHash) as { count: number };
    return row.count;
  }

  close() {
    this.db.close();
  }
}
