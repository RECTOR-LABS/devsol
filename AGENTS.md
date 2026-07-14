<!-- Satellite context file — extends the global hub (~/.claude/CLAUDE.md | ~/.pi/agent/AGENTS.md). Host-neutral; project-specific only. Do not duplicate hub standards here. -->

# DevSOL

> Devnet SOL marketplace. Users buy devnet SOL with mainnet USDC or sell devnet SOL to receive mainnet USDC. Both flows use direct deposits with memo-based matching.

## Stack

- **Runtime:** Node.js + TypeScript (ESM)
- **Framework:** Hono + @hono/node-server
- **Solana:** @solana/kit, @solana-program/{system,token,memo}
- **DB:** better-sqlite3 (file-based — `transactions` + `feedback`/`feedback_votes` tables)
- **Logging:** pino (structured JSON)
- **Testing:** Vitest (19 test files, 137 tests)
- **Frontend:** React 19 + Vite 7 + Tailwind 4 + @solana/wallet-adapter
- **Package manager:** pnpm

## Common Commands

```bash
pnpm dev            # tsx watch
pnpm build          # tsc
pnpm start          # node dist/index.js
pnpm test:run       # vitest run (all tests)
pnpm exec tsc --noEmit  # type-check
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` · `/health/detail` | Basic / detailed (treasury balances + pending orders) |
| GET | `/treasury` | Treasury address, balance, status |
| GET | `/price?amount_sol=N` | Buy/sell quotes |
| GET | `/tx/:id` | Transaction status lookup |
| POST | `/buy` | Create buy order (returns USDC deposit instructions) |
| POST | `/sell` | Create sell order (returns devnet SOL deposit instructions) |
| GET/POST | `/feedback` · POST `/feedback/:id/vote` | Feedback + IP-deduplicated upvotes |

## Architecture

```
src/
  index.ts              # Entry — wires services, starts server + both deposit detectors + expiry/auto-refund cleanup
  logger.ts · app.ts · config.ts · validation.ts
  deposit-handler.ts    # Sell onDeposit callback (payout or refund)
  buy-deposit-handler.ts# Buy onDeposit callback (devnet SOL delivery or USDC refund)
  routes/{buy,sell,price,treasury,tx,feedback}.ts
  services/
    treasury.ts         # Devnet SOL transfers
    payout.ts           # Mainnet USDC payouts (retry 3x exp backoff)
    pricing.ts          # Rate-based quotes (buy=1.05, sell=0.95 USDC/SOL)
    deposit.ts          # Polls devnet for SOL deposits (sell flow), memo/wallet+amount match
    buy-deposit.ts      # Polls mainnet for USDC deposits (buy flow), memo match
  db/{sqlite,feedback}.ts
scripts/{buy-e2e,sell-e2e,fund-test-wallet}.ts
```

## Flows

**Buy:** `POST /buy` → payout wallet address + memo + USDC cost → client sends mainnet USDC with memo → BuyDepositDetector matches → Treasury sends devnet SOL → `completed`. If SOL delivery fails, USDC refunded.

**Sell:** `POST /sell` → treasury address + memo → client sends devnet SOL with memo → DepositDetector matches (by memo, or wallet+amount for manual sends) → PayoutService sends mainnet USDC → `completed`. If payout fails, devnet SOL refunded. Duplicate pending sell orders (same wallet + amount) rejected with 409.

## Key Details

- Solana RPC returns memo as `"[byteLen] actualMemo"` — detectors strip `[N]` prefix before matching
- USDC conversion uses string-based `usdcToAtomicUnits()` to avoid float precision
- Payout retries 3x (1s, 2s, 4s), skips non-retryable errors
- Rate limiter: 60 req/min global, 10 req/min on `/buy` and `/sell`
- DB uses `atomicComplete()`/`atomicCompleteBuy()` for safe pending→completed transitions
- Buy pre-checks treasury SOL balance; sell pre-checks payout USDC reserves
- Both detectors require `DEVSOL_MAINNET_KEYPAIR`; verify on-chain amounts (SOL: 0.1% tolerance, USDC: exact)
- Pending orders expire after 30 min (cleanup every 60s); failed sells with confirmed deposits auto-refunded every 60s
- Low balance alerts when treasury SOL < 10 or payout USDC < 10
- Feedback: 3 posts/hour per IP, 10 votes/hour per IP, IP-hash dedup (SHA-256 truncated 16 hex), 1-500 chars

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DEVSOL_TREASURY_KEYPAIR` | Yes | — | Path to devnet treasury keypair JSON |
| `DEVSOL_MAINNET_KEYPAIR` | No | `""` (buy/sell disabled) | Path to mainnet payout keypair JSON |
| `DEVSOL_HELIUS_API_KEY` | No | — | Helius API key for mainnet RPC/WSS |
| `DEVSOL_MAINNET_RPC` / `DEVSOL_MAINNET_WSS` | No | public | Mainnet RPC/WSS (use Helius in prod) |
| `DEVSOL_DEVNET_RPC` | No | public RPC | Devnet RPC |
| `DEVSOL_PORT` | No | `3100` | Server port |
| `DEVSOL_BUY_PRICE` / `DEVSOL_SELL_PRICE` | No | `1.05` / `0.95` | USDC per devnet SOL |
| `DEVSOL_MAX_PAYOUT_USDC` / `DEVSOL_MIN_RESERVE_USDC` | No | `100` / `50` | Max payout / min reserve |
| `DEVSOL_DB_PATH` | No | `./devsol.db` | SQLite path |
| `DEVSOL_CORS_ORIGIN` | No | `https://devsol.rectorspace.com` | Allowed CORS origin |

## E2E Testing

```bash
# Requires DEVSOL_HELIUS_API_KEY + test keypair at ~/Documents/secret/devsol/test-user-keypair.json
MAINNET_RPC="https://mainnet.helius-rpc.com/?api-key=$DEVSOL_HELIUS_API_KEY" \
MAINNET_WSS="wss://mainnet.helius-rpc.com/?api-key=$DEVSOL_HELIUS_API_KEY" \
pnpm exec tsx scripts/buy-e2e.ts   # or sell-e2e.ts
```

## Deployment

Docker on VPS (176.222.53.185). GitHub Actions CI builds and pushes to GHCR, VPS pulls and restarts. Named volume `devsol-data` stores keypairs and DB. GitLab mirror via `mirror-gitlab.yml`.

## Wallets

- **Treasury** (devnet): `DSoLGdEsUxqx6a1LyUBdMq5sK8CXaoMVe19rFY34PoAt`
- **Payout** (mainnet): `Pay85GnSFPGf5tf72ae96pyYsN34fJzJm3G7CHHiHjx`
- **Test User:** `BuyhetgWkEQL4fwEZvWLH4zuzTHLDuRGwRKEY21c2z1V`
- Keypair backups: `~/Documents/secret/devsol/`