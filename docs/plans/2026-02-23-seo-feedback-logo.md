# SEO, Feedback System & Logo — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix page title/SEO, add public feedback with voting, and create a DevSOL brand logo.

**Architecture:** Three independent features. SEO is a single-file HTML change. Feedback requires a new DB class (`FeedbackDB`), 3 API routes, and 1 frontend component. Logo is an SVG file used in favicon + header.

**Tech Stack:** Hono (backend routes), better-sqlite3 (feedback storage), React + Tailwind (frontend component), SVG (logo)

---

### Task 1: SVG Logo

**Files:**
- Create: `frontend/public/devsol-logo.svg`
- Create: `frontend/public/favicon.svg`

**Step 1: Create the logo SVG**

Create `frontend/public/devsol-logo.svg` — a stylized "D" mark with Solana gradient. The icon combines a developer angle bracket `<` with the letter D, using the brand purple-to-lime gradient.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#9945FF"/>
      <stop offset="100%" stop-color="#14F195"/>
    </linearGradient>
  </defs>
  <rect width="40" height="40" rx="8" fill="#13131A"/>
  <path d="M12 10L6 20L12 30" stroke="url(#g)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M18 10h6a10 10 0 0 1 0 20h-6z" fill="url(#g)" opacity="0.9"/>
</svg>
```

**Step 2: Create favicon variant**

Copy `devsol-logo.svg` to `frontend/public/favicon.svg` (same file — SVG favicons work in all modern browsers).

**Step 3: Commit**

```
git add frontend/public/devsol-logo.svg frontend/public/favicon.svg
git commit -m "feat: add DevSOL SVG logo and favicon"
```

---

### Task 2: SEO Meta Tags + Favicon

**Files:**
- Modify: `frontend/index.html`

**Step 1: Update index.html**

Replace the entire `<head>` content:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>DevSOL — Buy & Sell Devnet SOL</title>
    <meta name="description" content="Marketplace for Solana devnet SOL. Buy devnet SOL with mainnet USDC or sell devnet SOL to receive USDC. Instant, transparent, open-source." />
    <meta property="og:title" content="DevSOL — Buy & Sell Devnet SOL" />
    <meta property="og:description" content="Instant devnet SOL with mainnet USDC. No faucets, no waiting." />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="https://devsol.rectorspace.com" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="DevSOL — Buy & Sell Devnet SOL" />
    <meta name="twitter:description" content="Instant devnet SOL with mainnet USDC. No faucets, no waiting." />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**Step 2: Delete old vite.svg**

```bash
rm frontend/public/vite.svg
```

**Step 3: Commit**

```
git add frontend/index.html
git rm frontend/public/vite.svg
git commit -m "feat: SEO meta tags, title, and favicon"
```

---

### Task 3: Header Logo Integration

**Files:**
- Modify: `frontend/src/components/Header.tsx`

**Step 1: Update Header to use logo SVG**

```tsx
export function Header() {
  return (
    <header className="w-full py-6">
      <div className="max-w-[960px] mx-auto px-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src="/devsol-logo.svg" alt="DevSOL" className="w-8 h-8" />
          <span className="text-2xl font-bold text-text-primary">DevSOL</span>
          <span className="text-sm text-text-secondary hidden sm:inline">Devnet SOL Marketplace</span>
        </div>
        <a
          href="https://github.com/RECTOR-LABS/devsol"
          target="_blank"
          rel="noopener noreferrer"
          className="text-text-muted hover:text-text-secondary text-sm transition-colors"
        >
          GitHub ↗
        </a>
      </div>
    </header>
  );
}
```

**Step 2: Commit**

```
git add frontend/src/components/Header.tsx
git commit -m "feat: add logo to header"
```

---

### Task 4: FeedbackDB — Database Layer

**Files:**
- Create: `src/db/feedback.ts`
- Create: `src/db/feedback.test.ts`

**Step 1: Write failing tests**

Create `src/db/feedback.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FeedbackDB } from './feedback.js';

describe('FeedbackDB', () => {
  let db: FeedbackDB;

  beforeEach(() => { db = new FeedbackDB(':memory:'); });
  afterEach(() => { db.close(); });

  it('creates feedback and retrieves it', () => {
    const fb = db.create({ content: 'Add dark mode toggle', author: 'DSoL...PoAt', ipHash: 'abc123' });
    expect(fb.id).toBeDefined();
    expect(fb.content).toBe('Add dark mode toggle');
    expect(fb.votes).toBe(0);

    const all = db.listAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(fb.id);
  });

  it('returns feedback sorted by votes descending', () => {
    const fb1 = db.create({ content: 'Feature A', ipHash: 'ip1' });
    const fb2 = db.create({ content: 'Feature B', ipHash: 'ip2' });
    db.vote(fb2.id, 'voter1');
    db.vote(fb2.id, 'voter2');
    db.vote(fb1.id, 'voter3');

    const all = db.listAll();
    expect(all[0].id).toBe(fb2.id);
    expect(all[0].votes).toBe(2);
    expect(all[1].votes).toBe(1);
  });

  it('prevents duplicate votes from same IP', () => {
    const fb = db.create({ content: 'Test', ipHash: 'ip1' });
    const first = db.vote(fb.id, 'same-ip');
    const second = db.vote(fb.id, 'same-ip');
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(db.listAll()[0].votes).toBe(1);
  });

  it('returns empty list when no feedback', () => {
    expect(db.listAll()).toEqual([]);
  });

  it('counts feedback by IP hash', () => {
    db.create({ content: 'First', ipHash: 'ip1' });
    db.create({ content: 'Second', ipHash: 'ip1' });
    db.create({ content: 'Third', ipHash: 'ip2' });
    expect(db.countByIp('ip1')).toBe(2);
    expect(db.countByIp('ip2')).toBe(1);
  });

  it('counts votes by IP hash', () => {
    const fb1 = db.create({ content: 'A', ipHash: 'ip1' });
    const fb2 = db.create({ content: 'B', ipHash: 'ip1' });
    db.vote(fb1.id, 'voter-ip');
    db.vote(fb2.id, 'voter-ip');
    expect(db.countVotesByIp('voter-ip')).toBe(2);
  });
});
```

**Step 2: Run tests — verify they fail**

```bash
pnpm test:run src/db/feedback.test.ts
```

Expected: FAIL — `Cannot find module './feedback.js'`

**Step 3: Implement FeedbackDB**

Create `src/db/feedback.ts`:

```typescript
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
      return false; // duplicate vote — PRIMARY KEY constraint
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

  close() { this.db.close(); }
}
```

**Step 4: Run tests — verify they pass**

```bash
pnpm test:run src/db/feedback.test.ts
```

Expected: 6 tests PASS

**Step 5: Commit**

```
git add src/db/feedback.ts src/db/feedback.test.ts
git commit -m "feat: FeedbackDB with create, list, vote, and rate limit helpers"
```

---

### Task 5: Feedback API Routes

**Files:**
- Create: `src/routes/feedback.ts`
- Create: `src/routes/feedback.test.ts`
- Modify: `src/app.ts:31-122` (mount routes + pass feedbackDb)

**Step 1: Write failing tests**

Create `src/routes/feedback.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createApp } from '../app.js';
import { FeedbackDB } from '../db/feedback.js';

describe('Feedback routes', () => {
  let feedbackDb: FeedbackDB;
  let app: ReturnType<typeof createApp>['app'];

  beforeEach(() => {
    feedbackDb = new FeedbackDB(':memory:');
    const result = createApp({ feedbackDb });
    app = result.app;
  });
  afterEach(() => feedbackDb.close());

  it('GET /feedback returns empty list initially', async () => {
    const res = await app.request('/feedback');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.feedback).toEqual([]);
  });

  it('POST /feedback creates feedback', async () => {
    const res = await app.request('/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Add SOL/USDC chart' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeDefined();
    expect(body.content).toBe('Add SOL/USDC chart');
    expect(body.votes).toBe(0);
  });

  it('POST /feedback validates content length', async () => {
    const res = await app.request('/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'short' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /feedback/:id/vote upvotes feedback', async () => {
    const create = await app.request('/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Add price alerts feature' }),
    });
    const { id } = await create.json();

    const vote = await app.request(`/feedback/${id}/vote`, { method: 'POST' });
    expect(vote.status).toBe(200);

    const list = await app.request('/feedback');
    const body = await list.json();
    expect(body.feedback[0].votes).toBe(1);
  });

  it('GET /feedback returns sorted by votes', async () => {
    const r1 = await app.request('/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Feature with fewer votes' }),
    });
    const r2 = await app.request('/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '2.2.2.2' },
      body: JSON.stringify({ content: 'Feature with more votes' }),
    });
    const { id: id2 } = await r2.json();
    await app.request(`/feedback/${id2}/vote`, { method: 'POST' });

    const list = await app.request('/feedback');
    const body = await list.json();
    expect(body.feedback[0].content).toBe('Feature with more votes');
  });
});
```

**Step 2: Run tests — verify they fail**

```bash
pnpm test:run src/routes/feedback.test.ts
```

Expected: FAIL — module not found

**Step 3: Create feedback routes**

Create `src/routes/feedback.ts`:

```typescript
import { Hono } from 'hono';
import { createHash } from 'crypto';
import type { FeedbackDB } from '../db/feedback.js';
import { createLogger } from '../logger.js';

const log = createLogger('feedback');

const MIN_CONTENT = 10;
const MAX_CONTENT = 500;
const MAX_POSTS_PER_HOUR = 3;
const MAX_VOTES_PER_HOUR = 10;

function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex').slice(0, 16);
}

export function feedbackRoutes(db: FeedbackDB) {
  const router = new Hono();

  router.get('/feedback', (c) => {
    const feedback = db.listAll();
    return c.json({ feedback });
  });

  router.post('/feedback', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.content !== 'string') {
      return c.json({ error: 'Content is required' }, 400);
    }

    const content = body.content.trim();
    if (content.length < MIN_CONTENT || content.length > MAX_CONTENT) {
      return c.json({ error: `Content must be ${MIN_CONTENT}-${MAX_CONTENT} characters` }, 400);
    }

    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const ipHash = hashIp(ip);

    if (db.countByIp(ipHash) >= MAX_POSTS_PER_HOUR) {
      log.warn(`Feedback rate limit: ${ipHash}`);
      return c.json({ error: 'Too many posts. Try again later.' }, 429);
    }

    const author = typeof body.author === 'string' && body.author.trim() ? body.author.trim() : null;
    const feedback = db.create({ content, author, ipHash });
    return c.json(feedback, 201);
  });

  router.post('/feedback/:id/vote', (c) => {
    const { id } = c.req.param();
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const ipHash = hashIp(ip);

    if (db.countVotesByIp(ipHash) >= MAX_VOTES_PER_HOUR) {
      return c.json({ error: 'Too many votes. Try again later.' }, 429);
    }

    const ok = db.vote(id, ipHash);
    if (!ok) {
      return c.json({ error: 'Already voted' }, 409);
    }
    return c.json({ ok: true });
  });

  return router;
}
```

**Step 4: Mount routes in app.ts**

In `src/app.ts`, add:
- Import: `import { FeedbackDB } from './db/feedback.js';`
- Import: `import { feedbackRoutes } from './routes/feedback.js';`
- Add `feedbackDb?: FeedbackDB` to `AppDeps` interface
- After existing route mounting (line 101), add: `app.route('/', feedbackRoutes(feedbackDb));`
- Initialize feedbackDb: `const feedbackDb = deps?.feedbackDb ?? new FeedbackDB(config.dbPath);`

**Step 5: Run tests — verify they pass**

```bash
pnpm test:run src/routes/feedback.test.ts
```

Expected: 5 tests PASS

**Step 6: Run ALL tests to verify no regressions**

```bash
pnpm test:run
```

Expected: All tests pass (including existing ones)

**Step 7: Commit**

```
git add src/routes/feedback.ts src/routes/feedback.test.ts src/app.ts
git commit -m "feat: feedback API routes with rate limiting and vote dedup"
```

---

### Task 6: Frontend — API Client + Types

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api.ts`

**Step 1: Add Feedback types**

Append to `frontend/src/types.ts`:

```typescript
export interface Feedback {
  id: string;
  author: string | null;
  content: string;
  votes: number;
  created_at: string;
}
```

**Step 2: Add feedback API methods**

Append to `frontend/src/api.ts` api object:

```typescript
  getFeedback: () => fetchJson<{ feedback: Feedback[] }>('/feedback'),
  postFeedback: (content: string, author?: string) =>
    fetchJson<Feedback>('/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, author }),
    }),
  voteFeedback: (id: string) =>
    fetchJson<{ ok: boolean }>(`/feedback/${id}/vote`, { method: 'POST' }),
```

**Step 3: Commit**

```
git add frontend/src/types.ts frontend/src/api.ts
git commit -m "feat: feedback types and API client methods"
```

---

### Task 7: Frontend — FeedbackSection Component

**Files:**
- Create: `frontend/src/components/FeedbackSection.tsx`
- Create: `frontend/src/hooks/useFeedback.ts`
- Modify: `frontend/src/App.tsx:1-46` (import + mount)

**Step 1: Create useFeedback hook**

Create `frontend/src/hooks/useFeedback.ts`:

```typescript
import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import type { Feedback } from '../types';

export function useFeedback() {
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { feedback } = await api.getFeedback();
      setFeedback(feedback);
    } catch {
      // silent — non-critical feature
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const submit = async (content: string, author?: string) => {
    const fb = await api.postFeedback(content, author);
    setFeedback((prev) => [fb, ...prev].sort((a, b) => b.votes - a.votes));
    return fb;
  };

  const vote = async (id: string) => {
    await api.voteFeedback(id);
    setFeedback((prev) =>
      prev.map((f) => (f.id === id ? { ...f, votes: f.votes + 1 } : f))
        .sort((a, b) => b.votes - a.votes)
    );
  };

  return { feedback, loading, submit, vote, refresh };
}
```

**Step 2: Create FeedbackSection component**

Create `frontend/src/components/FeedbackSection.tsx`:

```tsx
import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useFeedback } from '../hooks/useFeedback';

export function FeedbackSection() {
  const { feedback, loading, submit, vote } = useFeedback();
  const { publicKey } = useWallet();
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [votedIds, setVotedIds] = useState<Set<string>>(new Set());

  const walletLabel = publicKey
    ? `${publicKey.toBase58().slice(0, 4)}...${publicKey.toBase58().slice(-4)}`
    : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (content.trim().length < 10) {
      setError('Feedback must be at least 10 characters');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await submit(content.trim(), walletLabel ?? undefined);
      setContent('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVote(id: string) {
    if (votedIds.has(id)) return;
    try {
      await vote(id);
      setVotedIds((prev) => new Set(prev).add(id));
    } catch {
      // already voted or rate limited — ignore
    }
  }

  function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr + 'Z').getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  return (
    <section>
      <h2 className="text-xl font-bold mb-4">Feedback</h2>

      {/* Submit form */}
      <form onSubmit={handleSubmit} className="mb-6">
        <div className="flex gap-3">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Suggest a feature or improvement..."
            maxLength={500}
            rows={2}
            className="flex-1 bg-input-bg border border-input-border rounded-sm px-3 py-2 text-sm text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:border-primary"
          />
          <button
            type="submit"
            disabled={submitting || content.trim().length < 10}
            className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-sm hover:opacity-90 disabled:opacity-40 transition-opacity self-end"
          >
            {submitting ? '...' : 'Post'}
          </button>
        </div>
        {walletLabel && (
          <p className="text-xs text-text-muted mt-1">Posting as {walletLabel}</p>
        )}
        {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
      </form>

      {/* Feedback list */}
      {loading ? (
        <p className="text-text-muted text-sm">Loading...</p>
      ) : feedback.length === 0 ? (
        <p className="text-text-muted text-sm">No feedback yet. Be the first!</p>
      ) : (
        <div className="space-y-2">
          {feedback.map((fb) => (
            <div
              key={fb.id}
              className="flex items-start gap-3 bg-card-bg border border-card-border rounded-sm p-3"
            >
              <button
                onClick={() => handleVote(fb.id)}
                disabled={votedIds.has(fb.id)}
                className={`flex flex-col items-center min-w-[40px] pt-0.5 transition-colors ${
                  votedIds.has(fb.id) ? 'text-primary' : 'text-text-muted hover:text-primary'
                }`}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 4L3 10h10L8 4z" />
                </svg>
                <span className="text-xs font-medium">{fb.votes}</span>
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-text-primary">{fb.content}</p>
                <p className="text-xs text-text-muted mt-1">
                  {fb.author ?? 'Anonymous'} · {timeAgo(fb.created_at)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
```

**Step 3: Mount in App.tsx**

Add import at top of `frontend/src/App.tsx`:
```typescript
import { FeedbackSection } from './components/FeedbackSection';
```

Add `<FeedbackSection />` after `<TrustIndicators>` inside the `<main>` tag:
```tsx
        <TrustIndicators stats={stats} />
        <FeedbackSection />
```

**Step 4: Type-check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: Clean

**Step 5: Commit**

```
git add frontend/src/hooks/useFeedback.ts frontend/src/components/FeedbackSection.tsx frontend/src/App.tsx
git commit -m "feat: feedback section with submit form and upvoting"
```

---

### Task 8: Integration Test + Final Verification

**Step 1: Run backend tests**

```bash
pnpm test:run
```

Expected: All pass (new feedback tests included)

**Step 2: Type-check backend**

```bash
pnpm exec tsc --noEmit
```

**Step 3: Type-check frontend**

```bash
cd frontend && npx tsc --noEmit
```

**Step 4: Build frontend**

```bash
cd frontend && pnpm build
```

**Step 5: Visual verification**

Start dev server, open browser, verify:
- Page title shows "DevSOL — Buy & Sell Devnet SOL"
- Favicon shows the new logo
- Header shows logo icon + text
- Feedback section appears below TrustIndicators
- Can submit feedback and vote

**Step 6: Update CLAUDE.md**

Add to architecture section:
- `src/db/feedback.ts` — FeedbackDB for user feedback + voting
- `src/routes/feedback.ts` — GET/POST /feedback, POST /feedback/:id/vote
- `frontend/src/components/FeedbackSection.tsx` — Feedback UI with upvoting

Add to API endpoints table:
- `GET /feedback` — List all feedback (sorted by votes)
- `POST /feedback` — Submit feedback `{ content, author? }`
- `POST /feedback/:id/vote` — Upvote feedback

Add to Key Details:
- Feedback: anonymous posting, optional wallet identity, IP-hash vote deduplication
- Rate limits: 3 posts/hour, 10 votes/hour per IP

**Step 7: Final commit + deploy**

```
git add -A
git commit -m "docs: update CLAUDE.md with feedback system"
```

Merge to main and push to trigger deploy.
