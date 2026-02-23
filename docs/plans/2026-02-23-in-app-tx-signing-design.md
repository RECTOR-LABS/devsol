# In-App Transaction Signing — Design

**Goal:** Replace manual deposit instructions (copy address + memo) with one-click in-app transaction signing for both buy and sell flows.

**Problem:** Phantom wallet (and most Solana wallets) don't expose a memo field in their native send UI. Users can't complete orders without CLI tools.

**Solution:** Frontend builds the Solana transaction (transfer + memo instructions) and sends it via the wallet adapter. User sees one Phantom approval popup — no manual copying.

---

## Architecture

The Widget's `InstructionsView` becomes a `DepositView` with a "Send" button. When clicked:

1. Frontend builds a Solana transaction with transfer + memo instructions
2. Sends via wallet adapter (Phantom pops up once for approval)
3. Transitions to polling state (unchanged from current behavior)
4. Backend detects deposit on-chain, fulfills order

### Buy Flow (Mainnet USDC Transfer)

- Uses `useConnection()` from wallet adapter (already mainnet)
- Transaction instructions:
  - `createTransferCheckedInstruction` — SPL token transfer (USDC)
  - Memo program instruction with order memo (e.g., `devsol-f8830e5a`)
- Requires resolving user's USDC ATA and payout wallet's USDC ATA
- USDC mint: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (6 decimals)

### Sell Flow (Devnet SOL Transfer)

- Creates a **separate** `Connection` to devnet RPC (not from wallet adapter)
- Transaction instructions:
  - `SystemProgram.transfer` — native SOL transfer
  - Memo program instruction with order memo
- Uses `wallet.signTransaction()` to sign offline, then `devnetConnection.sendRawTransaction()` to submit
- The wallet signs bytes regardless of network — it doesn't validate the cluster

### Component Changes

```
Widget.tsx
├── handleSubmit() — creates order via API (unchanged)
├── DepositView (replaces InstructionsView)
│   ├── "Send 0.105 USDC" / "Send 0.1 SOL" button
│   ├── buildBuyTransaction() — USDC transfer + memo on mainnet
│   ├── buildSellTransaction() — SOL transfer + memo on devnet
│   ├── Sending/error/retry states
│   └── Manual fallback (copy address/memo) if wallet send fails
└── ResultView (unchanged)
```

### New File

- `frontend/src/lib/transactions.ts` — transaction building logic (pure functions, testable)

### New Dependency

- `@solana/spl-token` — for `createTransferCheckedInstruction`, `getAssociatedTokenAddress`

### State Flow

```
form → [create order] → deposit → [send tx] → waiting → [poll] → result
                                      ↓ (error)
                                  deposit (retry + show manual fallback)
```

### Error Handling

- **Wallet rejection:** Show error, offer retry button + manual fallback
- **Insufficient balance:** Phantom shows error natively, widget catches and displays
- **Network error:** Show error with retry
- **Tab closed:** Order expires in 30 min, no funds at risk

### User Experience

Both flows are identical from the user's perspective:

1. Connect wallet
2. Enter amount
3. Click buy/sell
4. Approve in Phantom (one popup)
5. Wait for completion

No copying addresses. No memos. No CLI.
