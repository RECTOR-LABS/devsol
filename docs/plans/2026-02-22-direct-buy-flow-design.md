# Direct Payment Buy Flow

Replace x402-based buy with deposit-based flow mirroring the sell pattern.

## Flow

```
POST /buy → deposit instructions (payout wallet, memo, USDC amount)
  → User sends mainnet USDC with memo
  → BuyDepositDetector polls mainnet, matches memo
  → handleBuyDeposit: deliver devnet SOL
  → If delivery fails → refund USDC on mainnet
```

## Route: POST /buy

Remove x402 dependency. Mirrors POST /sell:
- Validate wallet + amount_sol, pre-check treasury balance
- Generate memo `devsol-XXXX`, create DB record (type=buy, status=pending)
- Return: `{ transaction_id, status, deposit_address, memo, amount_sol, usdc_cost, instructions }`

## BuyDepositDetector

- Polls `getSignaturesForAddress` on payout wallet's USDC ATA on mainnet
- Matches pending buy orders by memo (same strip-prefix logic as sell)
- On match → atomicCompleteBuy → handleBuyDeposit callback
- Separate class from sell's DepositDetector (different chain, different address)

## handleBuyDeposit

1. Treasury pre-check (enough devnet SOL?)
2. Yes → `treasury.sendSol(wallet, sol_amount)` → update DB with devnet_tx
3. Treasury fails → refund USDC via `payout.sendUsdc(wallet, usdc_amount)` → status refunded
4. Both fail → status failed

## DB Changes

- `findPendingBuys()` — `WHERE type = 'buy' AND status = 'pending'`
- `atomicCompleteBuy(id, mainnetSig)` — sets mainnet_tx + status completed atomically

## Removed

- X402Service, @x402/core, @x402/hono, @x402/svm, @x402/fetch
- Facilitator config and health check

## Unchanged

- Sell flow, PayoutService, TreasuryService, rate limiter, validation, pricing
