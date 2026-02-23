# DevSOL: SEO, Feedback System & Logo

## Context

Three frontend improvements: fix generic page title for SEO, add a public feedback/voting system, and create a brand logo.

## Feature 1: SEO Title & Meta Tags

Update `frontend/index.html`:
- **Title**: `DevSOL — Buy & Sell Devnet SOL`
- **Description**: `Marketplace for Solana devnet SOL. Buy devnet SOL with mainnet USDC or sell devnet SOL to receive USDC. Instant, transparent, open-source.`
- OG tags: `og:title`, `og:description`, `og:type=website`, `og:url`
- Replace `vite.svg` favicon with DevSOL logo

Single-file change, no alternatives needed.

## Feature 2: Feedback System

### Storage

New `feedback` table in existing SQLite DB (`devsol.db`):

```sql
CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  author TEXT,          -- truncated wallet address or null (anonymous)
  content TEXT NOT NULL,
  votes INTEGER DEFAULT 0,
  ip_hash TEXT NOT NULL, -- SHA-256 of IP for vote deduplication
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE feedback_votes (
  feedback_id TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  PRIMARY KEY (feedback_id, ip_hash)
);
```

### Backend API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/feedback` | List all feedback, sorted by votes desc |
| POST | `/feedback` | Create feedback `{ content, author? }` |
| POST | `/feedback/:id/vote` | Upvote (one per IP) |

Spam protection:
- Rate limit: 3 posts/hour per IP, 10 votes/hour per IP
- Content length: 10-500 chars
- IP hash for vote deduplication (no double-voting)

### Frontend

New `<FeedbackSection />` component placed between TrustIndicators and Footer in App.tsx:
- Submit form at top (textarea + optional wallet display if connected)
- Feedback list sorted by votes (upvote button + count + content + author + timestamp)
- Anonymous posting; if wallet connected, author shown as truncated address

### Alternatives Considered

- **localStorage voting**: Simpler but easy to game, lost on device switch. Rejected.
- **Wallet-signed voting**: Prevents Sybil but adds friction for a devnet tool. Rejected.
- **IP-based dedup (chosen)**: Good enough for devnet marketplace. Low stakes, simple.

## Feature 3: Logo

SVG icon + "DevSOL" text wordmark using brand colors (`#9945FF` purple, `#14F195` lime).

Usage:
- Favicon (replace `vite.svg`)
- Header component (replace text-only "DevSOL")
- OG image reference

## Decisions

- Feedback stored in SQLite (same DB, no new infra)
- Anonymous posting, optional wallet identity
- IP-hash vote deduplication (no wallet signature required)
- Feedback section on main page below stats
- Simple upvotes only (no downvotes)
