# In-App Transaction Signing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace manual deposit instructions with one-click in-app transaction signing for both buy and sell flows.

**Architecture:** Frontend builds Solana transactions (transfer + memo) and sends them via wallet adapter. Buy uses mainnet connection from wallet adapter; sell creates a separate devnet connection and uses signTransaction + sendRawTransaction. Backend is unchanged.

**Tech Stack:** `@solana/web3.js`, `@solana/spl-token`, `@solana/wallet-adapter-react` (all already installed)

---

### Task 1: Create transaction builder module

**Files:**
- Create: `frontend/src/lib/transactions.ts`

This module exports two pure-ish async functions that build Solana transactions. They are separate from React components for testability and clarity.

**Implementation:**

```typescript
// frontend/src/lib/transactions.ts
import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';

const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const USDC_DECIMALS = 6;
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

function memoInstruction(memo: string, signer: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    keys: [{ pubkey: signer, isSigner: true, isWritable: false }],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(memo, 'utf-8'),
  });
}

/**
 * Build a mainnet USDC transfer + memo transaction (buy flow).
 * Caller sends this via wallet adapter's sendTransaction.
 */
export async function buildBuyTransaction(
  connection: Connection,
  sender: PublicKey,
  recipient: string,
  usdcAmount: number,
  memo: string,
): Promise<Transaction> {
  const recipientPubkey = new PublicKey(recipient);
  const senderAta = getAssociatedTokenAddressSync(USDC_MINT, sender);
  const recipientAta = getAssociatedTokenAddressSync(USDC_MINT, recipientPubkey);

  // Convert USDC to atomic units (e.g., 0.105 → 105000)
  const atomicAmount = BigInt(Math.round(usdcAmount * 10 ** USDC_DECIMALS));

  const tx = new Transaction();
  tx.add(
    createTransferCheckedInstruction(
      senderAta,
      USDC_MINT,
      recipientAta,
      sender,
      atomicAmount,
      USDC_DECIMALS,
    ),
  );
  tx.add(memoInstruction(memo, sender));

  tx.feePayer = sender;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  return tx;
}

const DEVNET_RPC = 'https://api.devnet.solana.com';

/**
 * Build a devnet SOL transfer + memo transaction (sell flow).
 * Returns { transaction, devnetConnection } — caller signs with wallet,
 * then submits via devnetConnection.sendRawTransaction().
 */
export async function buildSellTransaction(
  sender: PublicKey,
  recipient: string,
  solAmount: number,
  memo: string,
): Promise<{ transaction: Transaction; devnetConnection: Connection }> {
  const devnetConnection = new Connection(DEVNET_RPC, 'confirmed');
  const recipientPubkey = new PublicKey(recipient);

  const lamports = Math.round(solAmount * 1e9);

  const tx = new Transaction();
  tx.add(
    SystemProgram.transfer({
      fromPubkey: sender,
      toPubkey: recipientPubkey,
      lamports,
    }),
  );
  tx.add(memoInstruction(memo, sender));

  tx.feePayer = sender;
  tx.recentBlockhash = (await devnetConnection.getLatestBlockhash()).blockhash;

  return { transaction: tx, devnetConnection };
}
```

**Verify:** `pnpm exec tsc --noEmit` — should compile clean.

**Commit:** `feat: add transaction builder for buy and sell flows`

---

### Task 2: Update Widget — replace InstructionsView with DepositView

**Files:**
- Modify: `frontend/src/components/Widget.tsx`

Replace the `InstructionsView` component (which shows copy-paste instructions) with a `DepositView` that has a "Send" button. The DepositView needs access to the wallet adapter's `sendTransaction`, `signTransaction`, and `connection`.

**Key changes to Widget.tsx:**

1. Add imports:
```typescript
import { useConnection } from '@solana/wallet-adapter-react';
import { buildBuyTransaction, buildSellTransaction } from '../lib/transactions';
```

2. In the `Widget()` component, add:
```typescript
const { connection } = useConnection();
const { publicKey, connected, sendTransaction, signTransaction } = useWallet();
```

3. Replace `InstructionsView` usage with `DepositView`:
```typescript
{view === 'instructions' && orderResponse && publicKey && (
  <DepositView
    isBuy={isBuy}
    order={orderResponse}
    polling={polling}
    publicKey={publicKey}
    connection={connection}
    sendTransaction={sendTransaction}
    signTransaction={signTransaction}
  />
)}
```

4. The `DepositView` component:

```typescript
function DepositView({
  isBuy,
  order,
  polling,
  publicKey,
  connection,
  sendTransaction,
  signTransaction,
}: {
  isBuy: boolean;
  order: BuyResponse | SellResponse;
  polling: boolean;
  publicKey: PublicKey;
  connection: Connection;
  sendTransaction: WalletAdapterProps['sendTransaction'];
  signTransaction: WalletAdapterProps['signTransaction'] | undefined;
  }) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);

  const depositAmount = isBuy
    ? (order as BuyResponse).usdc_cost
    : (order as SellResponse).amount_sol;
  const currency = isBuy ? 'USDC' : 'SOL';

  async function handleSend() {
    setSending(true);
    setSendError(null);

    try {
      if (isBuy) {
        const tx = await buildBuyTransaction(
          connection,
          publicKey,
          order.deposit_address,
          (order as BuyResponse).usdc_cost,
          order.memo,
        );
        await sendTransaction(tx, connection);
      } else {
        if (!signTransaction) throw new Error('Wallet does not support signing');
        const { transaction, devnetConnection } = await buildSellTransaction(
          publicKey,
          order.deposit_address,
          (order as SellResponse).amount_sol,
          order.memo,
        );
        const signed = await signTransaction(transaction);
        await devnetConnection.sendRawTransaction(signed.serialize());
      }
      setSent(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Transaction failed';
      setSendError(msg);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-4">
      <h3 className="text-text-primary font-semibold text-base">
        {sent ? 'Deposit Sent' : 'Confirm Deposit'}
      </h3>

      <p className="text-text-secondary text-sm">
        {sent
          ? `Your ${currency} transfer has been submitted.`
          : `Send ${depositAmount} ${currency} to complete your order.`}
      </p>

      {/* Send button or status */}
      {!sent && !showManual && (
        <>
          <button
            type="button"
            onClick={handleSend}
            disabled={sending}
            className={`w-full h-12 rounded-[8px] font-semibold text-base transition-colors cursor-pointer ${
              isBuy
                ? 'bg-primary hover:bg-primary/90 text-white'
                : 'bg-accent hover:bg-accent/90 text-[#0A0A0F]'
            } ${sending ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {sending ? 'Sending...' : `Send ${depositAmount} ${currency}`}
          </button>

          {sendError && (
            <div className="text-red-400 text-sm text-center">{sendError}</div>
          )}

          <button
            type="button"
            onClick={() => setShowManual(true)}
            className="w-full text-text-muted text-xs hover:text-text-secondary text-center cursor-pointer"
          >
            Send manually instead
          </button>
        </>
      )}

      {/* Manual fallback — same as old InstructionsView */}
      {showManual && !sent && (
        <>
          <div className="bg-input-bg border border-input-border rounded-[8px] p-3">
            <span className="text-text-muted text-xs block mb-1">Address</span>
            <div className="flex items-center">
              <span className="text-text-primary text-sm font-mono truncate flex-1">
                {truncateAddress(order.deposit_address)}
              </span>
              <CopyButton text={order.deposit_address} />
            </div>
          </div>
          <div className="bg-input-bg border border-input-border rounded-[8px] p-3">
            <span className="text-text-muted text-xs block mb-1">Memo (required)</span>
            <div className="flex items-center">
              <span className="text-text-primary text-sm font-mono truncate flex-1">
                {order.memo}
              </span>
              <CopyButton text={order.memo} />
            </div>
          </div>
        </>
      )}

      {/* Transaction ID */}
      <div className="text-text-muted text-xs">
        TX: <span className="font-mono">{order.transaction_id}</span>
      </div>

      {/* Polling status */}
      {(sent || showManual) && polling && (
        <div className="flex items-center justify-center gap-2 py-3">
          <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          <span className="text-text-secondary text-sm">Waiting for confirmation...</span>
        </div>
      )}
    </div>
  );
}
```

5. Delete the old `InstructionsView` function entirely.

**Verify:** `pnpm exec tsc --noEmit` — should compile clean. `pnpm build` — should succeed.

**Commit:** `feat: replace manual deposit instructions with one-click send`

---

### Task 3: Handle wallet adapter types and edge cases

**Files:**
- Modify: `frontend/src/components/Widget.tsx`

Edge cases to handle:

1. **`signTransaction` might be undefined** — some wallet adapters don't support it. The sell flow needs it. If undefined, fall back to manual instructions automatically for sell.

2. **Buffer polyfill** — `@solana/web3.js` uses `Buffer` which may not be available in the browser. Vite needs a polyfill. Check if the existing setup already handles this (wallet adapter may have pulled it in). If not:
   - Install: `pnpm add buffer`
   - Add to `frontend/src/main.tsx` at the top: `import { Buffer } from 'buffer'; window.Buffer = Buffer;`

3. **Connection for sell flow** — the devnet RPC URL should use the env var `VITE_DEVNET_RPC` with fallback to public RPC:
   - Update `buildSellTransaction` to accept an optional RPC URL parameter
   - Or read from env in the module: `const DEVNET_RPC = import.meta.env.VITE_DEVNET_RPC || 'https://api.devnet.solana.com';`

**Verify:** Open site in browser, connect wallet, test buy flow (enter 0.1 SOL, click Buy, click Send — Phantom should pop up). Test sell flow similarly.

**Commit:** `fix: handle edge cases for in-app transaction signing`

---

### Task 4: Build, verify, and deploy

**Files:**
- Modify: `frontend/.env.production` (if devnet RPC env var needed)

**Steps:**

1. Run `pnpm exec tsc --noEmit` — types clean
2. Run `pnpm build` — build succeeds, check bundle size
3. Test locally: `pnpm dev` — open site, connect wallet, verify both buy and sell flows show the "Send" button instead of copy-paste instructions
4. Commit any final tweaks
5. Merge to main and push — CD deploys automatically

**Commit:** `chore: final build verification for in-app signing`

---

## Execution Order

1 → 2 → 3 → 4 (sequential — each builds on the previous)

## Verification

- `pnpm exec tsc --noEmit` — clean
- `pnpm build` — succeeds
- Manual browser test: connect Phantom, buy 0.1 SOL, see "Send 0.105 USDC" button, click, approve in Phantom
- Manual browser test: sell 0.1 SOL, see "Send 0.1 SOL" button, click, approve in Phantom
- Fallback: click "Send manually instead" — see old copy-paste instructions
