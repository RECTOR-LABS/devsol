# DevSOL

Solana devnet SOL marketplace. Buy and sell devnet SOL instantly via x402 payments.

## Problem

Solana devnet faucets are unreliable and heavily rate-limited. Developers waste valuable time waiting for devnet SOL instead of building. DevSOL provides instant, reliable access to devnet SOL for a small fee.

## How It Works

- **Buy:** Pay USDC (Solana mainnet) via x402 protocol → receive devnet SOL instantly
- **Sell:** Send devnet SOL to treasury → receive USDC on Solana mainnet

## Pricing

| Action | Rate |
|--------|------|
| Buy    | 1 SOL devnet = 1.05 USDC |
| Sell   | 1 SOL devnet = 0.95 USDC |

## Stack

- **Runtime:** Node.js + Hono
- **Payments:** x402 protocol (`@x402/svm`, `@x402/hono`)
- **Blockchain:** `@solana/kit` (mainnet + devnet)
- **Database:** SQLite (transaction log)
- **Deployment:** Docker on VPS, nginx reverse proxy

## API

```
GET  /price        → Current buy/sell prices
GET  /treasury     → Available SOL balance
POST /buy          → Purchase devnet SOL (x402-protected)
POST /sell         → Sell devnet SOL for USDC
GET  /tx/:id       → Transaction receipt
```

## License

MIT
