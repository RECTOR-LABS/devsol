# DevSOL

Devnet SOL marketplace. Users buy devnet SOL with mainnet USDC or sell devnet SOL to receive mainnet USDC. Both flows use direct deposits with memo-based matching.

## Stack

- **Runtime**: Node.js + TypeScript (ESM)
- **Framework**: Hono + @hono/node-server
- **Solana**: @solana/kit, @solana-program/system, @solana-program/token, @solana-program/memo
- **DB**: better-sqlite3 (file-based, single table `transactions`)
- **Testing**: Vitest
- **Package Manager**: pnpm

## Commands

```bash
pnpm dev            # tsx watch
pnpm build          # tsc
pnpm start          # node dist/index.js
pnpm test:run       # vitest run (all tests)
pnpm exec tsc --noEmit  # type-check without emitting
```

## Architecture

```
src/
  index.ts              # Entry — wires services, starts server + deposit detector
  app.ts                # Hono app, rate limiter, CORS, route mounting
  config.ts             # All env vars with defaults
  deposit-handler.ts    # Sell onDeposit callback (payout or refund logic)
  buy-deposit-handler.ts # Buy onDeposit callback (devnet SOL delivery or USDC refund)
  validation.ts         # Wallet address + amount validators
  routes/
    buy.ts              # POST /buy — creates pending order, returns USDC deposit instructions
    sell.ts             # POST /sell — creates pending order, returns devnet SOL deposit instructions
    price.ts            # GET /price?amount_sol=N — buy/sell quotes
    treasury.ts         # GET /treasury, GET /health/detail
    tx.ts               # GET /tx/:id — transaction status lookup
  services/
    treasury.ts         # Devnet SOL transfers (sendSol, getBalance)
    payout.ts           # Mainnet USDC payouts (sendUsdc, canAffordPayout) with retry
    pricing.ts          # Rate-based quotes (buy=1.05, sell=0.95 USDC/SOL)
    deposit.ts          # Polls devnet for incoming SOL deposits (sell flow), matches by memo
    buy-deposit.ts      # Polls mainnet for incoming USDC deposits (buy flow), matches by memo
  db/
    sqlite.ts           # TransactionDB — CRUD, atomicComplete/Buy, findPendingSells/Buys
```

## Flows

**Buy**: Client `POST /buy` → gets payout wallet address + memo + USDC cost → client sends mainnet USDC with memo → BuyDepositDetector matches deposit → Treasury sends devnet SOL → status `completed`. If SOL delivery fails, USDC is refunded.

**Sell**: Client `POST /sell` → gets treasury address + memo → client sends devnet SOL with memo → DepositDetector matches deposit → PayoutService sends mainnet USDC → status `completed`. If payout fails, devnet SOL is refunded.

## Key Details

- Solana RPC returns memo as `"[byteLen] actualMemo"` — deposit detector strips `[N]` prefix before matching
- USDC conversion uses string-based `usdcToAtomicUnits()` to avoid float precision issues
- Payout retries 3x with exponential backoff (1s, 2s, 4s), skips non-retryable errors
- Rate limiter: 60 req/min global, 10 req/min on `/buy` and `/sell`
- DB uses `atomicComplete()` for safe pending→completed transitions

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DEVSOL_TREASURY_KEYPAIR` | Yes | — | Path to devnet treasury keypair JSON |
| `DEVSOL_MAINNET_KEYPAIR` | No | `""` (sell disabled) | Path to mainnet payout keypair JSON |
| `DEVSOL_MAINNET_RPC` | No | public RPC | Mainnet RPC (use Helius in prod) |
| `DEVSOL_MAINNET_WSS` | No | public WSS | Mainnet WebSocket |
| `DEVSOL_DEVNET_RPC` | No | public RPC | Devnet RPC |
| `DEVSOL_PORT` | No | `3100` | Server port |
| `DEVSOL_BUY_PRICE` | No | `1.05` | USDC per devnet SOL (buy) |
| `DEVSOL_SELL_PRICE` | No | `0.95` | USDC per devnet SOL (sell) |
| `DEVSOL_MAX_PAYOUT_USDC` | No | `100` | Max single payout |
| `DEVSOL_MIN_RESERVE_USDC` | No | `50` | Min USDC reserve before refusing payouts |
| `DEVSOL_DB_PATH` | No | `./devsol.db` | SQLite database path |
| `DEVSOL_CORS_ORIGIN` | No | `https://devsol.rectorspace.com` | Allowed CORS origin |

## Deployment

Docker on VPS (176.222.53.185). GitHub Actions CI builds and pushes to GHCR, VPS pulls and restarts. Named volume `devsol-data` stores keypairs and DB.

## Wallets

- **Treasury** (devnet): `DSoLGdEsUxqx6a1LyUBdMq5sK8CXaoMVe19rFY34PoAt`
- **Payout** (mainnet): `Pay85GnSFPGf5tf72ae96pyYsN34fJzJm3G7CHHiHjx`
- Keypair backups: `~/Documents/secret/devsol/`
