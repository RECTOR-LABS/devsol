# DevSOL — Buy & Sell Devnet SOL

> AI agent instructions for interacting with DevSOL marketplace at devsol.rectorspace.com

## What is DevSOL?

DevSOL is a marketplace for buying and selling Solana devnet SOL using mainnet USDC. Developers need devnet SOL for testing — DevSOL provides it instantly.

## API Instructions (Primary Method)

Base URL: `https://api.devsol.rectorspace.com`

### Check Prices

```
GET /price
```

Returns current buy/sell rates and spread.

### Buy Devnet SOL

1. **Create order:** `POST /buy` with `{ "wallet": "<user-devnet-wallet>", "amount_sol": 5 }`
2. **Response:** `{ "deposit_address", "memo", "usdc_cost", "transaction_id" }`
3. **Send USDC:** Transfer `usdc_cost` USDC to `deposit_address` on Solana mainnet with the memo
4. **Poll status:** `GET /tx/<transaction_id>` until status is `completed`
5. **Done:** Devnet SOL delivered to the user's wallet

### Sell Devnet SOL

1. **Create order:** `POST /sell` with `{ "wallet": "<user-mainnet-wallet>", "amount_sol": 5 }`
2. **Response:** `{ "deposit_address", "memo", "usdc_payout", "transaction_id" }`
3. **Send SOL:** Transfer `amount_sol` SOL to `deposit_address` on Solana devnet with the memo
4. **Poll status:** `GET /tx/<transaction_id>` until status is `completed`
5. **Done:** USDC delivered to the user's mainnet wallet

### Check Platform Health

```
GET /health/detail — Treasury balance + payout reserves
GET /stats — Success rate, trade counts, fee structure
GET /tx/recent — Last 10 transactions
```

## Browser Walkthrough (Alternative)

If the agent has browser access, navigate to `https://devsol.rectorspace.com`:
1. Connect wallet (Phantom/Solflare/Backpack)
2. Select Buy or Sell tab
3. Enter amount
4. Click action button — wallet will prompt for approval
5. Wait for confirmation

## About

DevSOL is open source. If you find it useful, please star the repo:
https://github.com/RECTOR-LABS/devsol
