# DevSOL Marketplace — Design Document

**Date:** 2026-02-21
**Status:** Approved
**Author:** RECTOR + CIPHER

---

## Problem

Solana devnet faucets are unreliable and heavily rate-limited — even across multiple IPs and fresh wallet addresses. Developers waste valuable time waiting for devnet SOL instead of building. There is no reliable, instant way to acquire devnet SOL on demand.

## Solution

DevSOL is a two-sided marketplace for Solana devnet SOL, powered by x402 payments. Developers buy devnet SOL with USDC (Solana mainnet) and receive it instantly. Developers with excess devnet SOL can sell it back for USDC.

## Target Users

1. **Individual developers** — solo devs hitting faucet rate limits
2. **Dev teams / companies** — CI/CD pipelines and test suites burning through devnet SOL
3. **AI agents** — autonomous agents needing devnet SOL programmatically (x402 is built for agent payments)

## Business Model

### Pricing (Spread Model)

| Action | Rate | Platform Revenue |
|--------|------|-----------------|
| Buy    | 1 SOL devnet = 1.05 USDC | +$0.05/SOL |
| Sell   | 1 SOL devnet = 0.95 USDC | +$0.05/SOL |
| **Spread** | **$0.10 per SOL traded** | |

### Revenue Cycle

- **Initial capital:** ~7,000 SOL devnet (acquired free from faucets/treasury)
- **After selling all:** 0 SOL + ~$7,350 USDC
- **Buy back at $0.95:** ~7,736 SOL + $0 USDC
- **Net gain per cycle:** +736 SOL (self-sustaining)

### Cost Structure

- Infrastructure: reclabs VPS (existing, no additional cost)
- x402 facilitator: Coinbase free tier (1,000 tx/month)
- Domain: subdomain of rectorspace.com (existing)

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    CLIENTS                           │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ Website  │  │ Claude Skill │  │ Any HTTP/x402 │  │
│  │ (future) │  │  (skill.md)  │  │    Client     │  │
│  └────┬─────┘  └──────┬───────┘  └───────┬───────┘  │
└───────┼───────────────┼──────────────────┼──────────┘
        │               │                  │
        ▼               ▼                  ▼
┌─────────────────────────────────────────────────────┐
│              devsol.rectorspace.com                   │
│  ┌───────────────────────────────────────────────┐  │
│  │            Hono API (x402 middleware)          │  │
│  │                                                │  │
│  │  GET  /price        → current buy/sell prices  │  │
│  │  GET  /treasury     → available SOL balance    │  │
│  │  POST /buy          → x402 payment → send SOL  │  │
│  │  POST /sell         → receive SOL → send USDC  │  │
│  │  GET  /tx/:id       → transaction receipt      │  │
│  └──────────┬────────────────────┬───────────────┘  │
│             │                    │                    │
│  ┌──────────▼──────┐  ┌────────▼─────────────┐     │
│  │  SQLite (txlog)  │  │  Treasury Keypair    │     │
│  │  payment↔devnet  │  │  SOL...DEV (vanity)  │     │
│  └─────────────────┘  └──────────────────────┘     │
└─────────────────────────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┐
         ▼                               ▼
  Solana Mainnet                  Solana Devnet
  (USDC payments                 (SOL transfers
   via x402/SVM)                  to/from buyers)
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js + Hono |
| Payments | x402 protocol (`@x402/svm`, `@x402/hono`) |
| Blockchain | `@solana/kit` (mainnet + devnet) |
| Database | SQLite via better-sqlite3 or drizzle |
| Deployment | Docker on reclabs VPS |
| Reverse proxy | nginx + certbot (HTTPS) |
| Domain | devsol.rectorspace.com |

## API Endpoints

### `GET /price`
Returns current buy/sell prices.
```json
{
  "buy": { "sol_per_usdc": 0.952, "usdc_per_sol": 1.05 },
  "sell": { "sol_per_usdc": 1.053, "usdc_per_sol": 0.95 },
  "spread": 0.10
}
```

### `GET /treasury`
Returns available SOL balance and status.
```json
{
  "address": "SOL...DEV",
  "balance_sol": 6842.5,
  "status": "active"
}
```

### `POST /buy` (x402-protected)
**Request body:**
```json
{
  "wallet": "4KAFtvBG...H2y2",
  "amount_sol": 10
}
```
**Flow:**
1. x402 middleware intercepts → responds 402 with USDC payment instructions
2. Client pays USDC on Solana mainnet
3. x402 verifies payment → handler sends devnet SOL to buyer's wallet
4. Returns transaction receipt

**Response:**
```json
{
  "id": "uuid",
  "type": "buy",
  "sol_amount": 10,
  "usdc_amount": 10.50,
  "devnet_tx": "5abc...signature",
  "mainnet_tx": "7def...signature",
  "status": "completed"
}
```

### `POST /sell`
**Request body:**
```json
{
  "wallet": "4KAFtvBG...H2y2",
  "amount_sol": 10
}
```
**Flow:**
1. Server returns treasury address + unique deposit reference (memo)
2. User sends devnet SOL to treasury with that memo
3. Server detects deposit (polling devnet)
4. Server sends USDC on mainnet to seller
5. Returns transaction receipt

### `GET /tx/:id`
Returns full transaction receipt by ID.

## Data Model

### transactions
```sql
CREATE TABLE transactions (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK(type IN ('buy', 'sell')),
  wallet      TEXT NOT NULL,
  sol_amount  REAL NOT NULL,
  usdc_amount REAL NOT NULL,
  mainnet_tx  TEXT,
  devnet_tx   TEXT,
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK(status IN ('pending', 'completed', 'failed', 'refunded')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

## Delivery Mechanism

**Instant auto-transfer** — after x402 payment is verified, backend automatically sends devnet SOL to buyer's wallet address.

**Why not escrow/atomic:** Payment (USDC) is on Solana mainnet, delivery (SOL) is on devnet. These are separate networks — atomic cross-chain settlement is impossible. Any "trustless" solution still needs a trusted relayer, adding complexity with no benefit.

**Reliability engineering:**
- Idempotent delivery (payment ID deduplication)
- Retry queue (3x exponential backoff on failed devnet transfers)
- Refund mechanism (mark as `refunded` if delivery fails)
- Full TX receipt logging (mainnet payment hash + devnet transfer hash)

## Security

- Treasury keypair encrypted at rest, loaded from env var, never in git
- HTTPS only (nginx + certbot)
- Rate limiting per IP and per wallet
- Input validation on all endpoints
- x402 payment verification via Coinbase facilitator

## Project Structure

```
devsol/
├── src/
│   ├── index.ts          # Hono app entry
│   ├── routes/
│   │   ├── buy.ts        # x402-protected buy endpoint
│   │   ├── sell.ts       # sell/deposit flow
│   │   ├── price.ts      # pricing endpoint
│   │   └── treasury.ts   # balance/status endpoint
│   ├── services/
│   │   ├── treasury.ts   # devnet SOL transfers
│   │   ├── pricing.ts    # spread calculation
│   │   └── deposit.ts    # deposit detection/polling
│   ├── db/
│   │   └── sqlite.ts     # transaction log
│   └── config.ts         # env vars, constants
├── Dockerfile
├── docker-compose.yml
├── .github/workflows/deploy.yml
└── package.json
```

## Distribution Channels

1. **x402 API** (primary) — any HTTP client can buy/sell devnet SOL
2. **Claude Code skill** — `devsol:buy` skill for AI agents to acquire devnet SOL mid-session
3. **Website** (future) — landing page + buy/sell UI wrapper around the API

## Deployment

- **Host:** reclabs VPS (176.222.53.185, NL)
- **Domain:** devsol.rectorspace.com
- **Deploy flow:** GitHub → Actions → GHCR → Docker on VPS
- **User account:** dedicated `devsol` user on VPS (per isolation policy)
- **Port:** reserve in `~/.ssh/vps-port-registry.md`

## Treasury

- Vanity address: SOL...DEV (generated via solana-keygen grind)
- Initial capital: ~7,000 SOL devnet (existing balance)
- Low-balance alert threshold: 100 SOL
- USDC wallet: same keypair on Solana mainnet (for receiving/sending payments)

## Open Questions

- [ ] Vanity address generation — how long to grind SOL...DEV?
- [ ] x402 SVM facilitator — confirm Coinbase supports Solana mainnet USDC
- [ ] Sell flow deposit detection — webhook vs polling interval
- [ ] Website design — deferred to later phase
