# Phase 2: Frontend + Transparency + Skill Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a React SPA at `devsol.rectorspace.com` with buy/sell widget, live treasury transparency, transaction feed, and a hosted `skill.md` for AI agents.

**Architecture:** Monorepo — `frontend/` directory with Vite + React 19 + Tailwind v4. Backend gets 2 new endpoints (`GET /stats`, `GET /tx/recent`). Frontend talks to API at `api.devsol.rectorspace.com` (existing). Static files served by nginx on same VPS. Hosted `skill.md` served as a static file from the frontend build.

**Tech Stack:** React 19, Vite 6, Tailwind v4, `@solana/wallet-adapter-react`, `@solana/web3.js` (wallet adapter requires it), TypeScript 5.9

**Design Reference:** `design/devsol-widget.pen` — 4 screens (Buy, Sell, Transaction Status, Full Page with transparency)

---

## Track A: Backend (New Endpoints)

### Task 1: Add `countByStatus()` and `getRecent()` to TransactionDB

**Files:**
- Modify: `src/db/sqlite.ts`
- Test: `src/db/sqlite.test.ts`

**Step 1: Write the failing tests**

In `src/db/sqlite.test.ts`, add these tests:

```typescript
it('counts transactions by status', () => {
  db.create({ type: 'buy', wallet: 'a', sol_amount: 1, usdc_amount: 1.05 });
  db.create({ type: 'sell', wallet: 'b', sol_amount: 2, usdc_amount: 1.90 });
  const tx3 = db.create({ type: 'buy', wallet: 'c', sol_amount: 3, usdc_amount: 3.15 });
  db.update(tx3.id, { status: 'completed' });

  const counts = db.countByStatus();
  expect(counts.pending).toBe(2);
  expect(counts.completed).toBe(1);
  expect(counts.total).toBe(3);
});

it('returns recent transactions truncated', () => {
  for (let i = 0; i < 15; i++) {
    const tx = db.create({ type: i % 2 === 0 ? 'buy' : 'sell', wallet: `wallet${i}xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`, sol_amount: i + 1, usdc_amount: (i + 1) * 1.05 });
    if (i < 10) db.update(tx.id, { status: 'completed' });
  }

  const recent = db.getRecent(10);
  expect(recent).toHaveLength(10);
  // Most recent first
  expect(recent[0].sol_amount).toBeGreaterThanOrEqual(recent[1].sol_amount);
  // Wallet is truncated
  expect(recent[0].wallet).toMatch(/^.{4}\.\.\..{4}$/);
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm test:run -- src/db/sqlite.test.ts`
Expected: FAIL — `countByStatus` and `getRecent` not defined

**Step 3: Implement in `src/db/sqlite.ts`**

Add these methods to the `TransactionDB` class:

```typescript
countByStatus(): { pending: number; completed: number; failed: number; refunded: number; expired: number; total: number } {
  const rows = this.db
    .prepare('SELECT status, COUNT(*) as count FROM transactions GROUP BY status')
    .all() as Array<{ status: string; count: number }>;
  const counts = { pending: 0, completed: 0, failed: 0, refunded: 0, expired: 0, total: 0 };
  for (const row of rows) {
    counts[row.status as keyof typeof counts] = row.count;
    counts.total += row.count;
  }
  return counts;
}

getRecent(limit: number = 10): Array<{ id: string; type: string; wallet: string; sol_amount: number; usdc_amount: number; status: string; created_at: string }> {
  const rows = this.db
    .prepare('SELECT id, type, wallet, sol_amount, usdc_amount, status, created_at FROM transactions ORDER BY created_at DESC LIMIT ?')
    .all(limit) as Array<{ id: string; type: string; wallet: string; sol_amount: number; usdc_amount: number; status: string; created_at: string }>;
  return rows.map((r) => ({
    ...r,
    wallet: r.wallet.length > 8 ? `${r.wallet.slice(0, 4)}...${r.wallet.slice(-4)}` : r.wallet,
  }));
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm test:run -- src/db/sqlite.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/db/sqlite.ts src/db/sqlite.test.ts
git commit -m "feat: add countByStatus and getRecent to TransactionDB"
```

---

### Task 2: Add `GET /stats` and `GET /tx/recent` endpoints

**Files:**
- Create: `src/routes/stats.ts`
- Create: `src/routes/stats.test.ts`
- Modify: `src/routes/tx.ts`
- Modify: `src/routes/tx.test.ts`
- Modify: `src/app.ts`

**Step 1: Write the failing tests for stats route**

Create `src/routes/stats.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TransactionDB } from '../db/sqlite.js';
import { PricingService } from '../services/pricing.js';
import { statsRoutes } from './stats.js';
import { Hono } from 'hono';

describe('GET /stats', () => {
  let db: TransactionDB;
  let app: Hono;

  beforeEach(() => {
    db = new TransactionDB(':memory:');
    const pricing = new PricingService(1.05, 0.95);
    app = new Hono();
    app.route('/', statsRoutes(db, pricing));
  });

  afterEach(() => db.close());

  it('returns platform stats with counts and rates', async () => {
    db.create({ type: 'buy', wallet: 'a', sol_amount: 1, usdc_amount: 1.05 });
    const tx = db.create({ type: 'sell', wallet: 'b', sol_amount: 2, usdc_amount: 1.90 });
    db.update(tx.id, { status: 'completed' });

    const res = await app.request('/stats');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total_trades).toBe(2);
    expect(body.completed_trades).toBe(1);
    expect(body.pending_orders).toBe(1);
    expect(body.success_rate).toBeDefined();
    expect(body.buy_rate).toBe(1.05);
    expect(body.sell_rate).toBe(0.95);
    expect(body.spread).toBeDefined();
    expect(body.network_fees).toBe('included');
  });

  it('handles zero trades without division by zero', async () => {
    const res = await app.request('/stats');
    const body = await res.json();
    expect(body.total_trades).toBe(0);
    expect(body.success_rate).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test:run -- src/routes/stats.test.ts`
Expected: FAIL — module not found

**Step 3: Implement stats route**

Create `src/routes/stats.ts`:

```typescript
import { Hono } from 'hono';
import type { TransactionDB } from '../db/sqlite.js';
import type { PricingService } from '../services/pricing.js';

export function statsRoutes(db: TransactionDB, pricing: PricingService) {
  const router = new Hono();

  router.get('/stats', (c) => {
    const counts = db.countByStatus();
    const summary = pricing.summary();
    const denominator = counts.completed + counts.failed + counts.refunded;
    const successRate = denominator > 0 ? Math.round((counts.completed / denominator) * 1000) / 10 : 0;

    return c.json({
      total_trades: counts.total,
      completed_trades: counts.completed,
      pending_orders: counts.pending,
      failed_trades: counts.failed,
      refunded_trades: counts.refunded,
      success_rate: successRate,
      buy_rate: summary.buy.usdc_per_sol,
      sell_rate: summary.sell.usdc_per_sol,
      spread: summary.spread,
      network_fees: 'included',
    });
  });

  return router;
}
```

**Step 4: Run stats test to verify it passes**

Run: `pnpm test:run -- src/routes/stats.test.ts`
Expected: PASS

**Step 5: Write failing test for `GET /tx/recent`**

Add to `src/routes/tx.test.ts`:

```typescript
it('returns recent transactions', async () => {
  db.create({ type: 'buy', wallet: 'BuyerWalletXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', sol_amount: 5, usdc_amount: 5.25 });

  const res = await app.request('/tx/recent');
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.transactions).toHaveLength(1);
  expect(body.transactions[0].wallet).toBe('Buye...XXXX');
  expect(body.transactions[0].type).toBe('buy');
});

it('limits recent transactions to 10', async () => {
  for (let i = 0; i < 15; i++) {
    db.create({ type: 'buy', wallet: `w${i}xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`, sol_amount: 1, usdc_amount: 1.05 });
  }

  const res = await app.request('/tx/recent');
  const body = await res.json();
  expect(body.transactions).toHaveLength(10);
});
```

**Step 6: Implement `GET /tx/recent` in `src/routes/tx.ts`**

```typescript
import { Hono } from 'hono';
import type { TransactionDB } from '../db/sqlite.js';

export function txRoutes(db: TransactionDB) {
  const router = new Hono();

  router.get('/tx/recent', (c) => {
    const transactions = db.getRecent(10);
    return c.json({ transactions });
  });

  router.get('/tx/:id', (c) => {
    const tx = db.getById(c.req.param('id'));
    if (!tx) return c.json({ error: 'Transaction not found' }, 404);
    return c.json(tx);
  });

  return router;
}
```

**Important:** `/tx/recent` MUST be registered before `/tx/:id` — otherwise `:id` captures "recent" as a UUID.

**Step 7: Mount stats route in `src/app.ts`**

Add import:
```typescript
import { statsRoutes } from './routes/stats.js';
```

After `app.route('/', txRoutes(db));` (line 99), add:
```typescript
app.route('/', statsRoutes(db, pricing));
```

**Step 8: Run all tests**

Run: `pnpm test:run`
Expected: ALL PASS (including existing tx tests)

**Step 9: Type check**

Run: `pnpm exec tsc --noEmit`
Expected: Clean

**Step 10: Commit**

```bash
git add src/routes/stats.ts src/routes/stats.test.ts src/routes/tx.ts src/routes/tx.test.ts src/app.ts
git commit -m "feat: add GET /stats and GET /tx/recent endpoints for frontend"
```

---

## Track B: Frontend

### Task 3: Scaffold Vite + React + Tailwind project

**Files:**
- Create: `frontend/` directory (Vite scaffold)
- Modify: root `package.json` (add workspace script)

**Step 1: Scaffold with Vite**

```bash
cd /Users/rector/local-dev/devsol
pnpm create vite frontend --template react-ts
```

**Step 2: Install dependencies**

```bash
cd /Users/rector/local-dev/devsol/frontend
pnpm install
pnpm add @solana/wallet-adapter-base @solana/wallet-adapter-react @solana/wallet-adapter-react-ui @solana/wallet-adapter-wallets @solana/web3.js@1 tailwindcss @tailwindcss/vite
```

Note: wallet-adapter requires `@solana/web3.js` v1 (legacy). This is isolated to the frontend — the backend uses `@solana/kit`.

**Step 3: Configure Tailwind v4**

Replace `frontend/src/index.css`:

```css
@import "tailwindcss";

@theme {
  --color-bg: #0A0A0F;
  --color-card-bg: #13131A;
  --color-card-border: #1E1E2A;
  --color-input-bg: #0D0D14;
  --color-input-border: #252535;
  --color-primary: #9945FF;
  --color-accent: #14F195;
  --color-usdc: #2775CA;
  --color-text-primary: #F0F0F5;
  --color-text-secondary: #8888A0;
  --color-text-muted: #55556A;
  --font-sans: "Inter", system-ui, sans-serif;
  --radius-default: 12px;
  --radius-sm: 8px;
}
```

**Step 4: Configure Vite**

Replace `frontend/vite.config.ts`:

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3100',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
```

**Step 5: Clean up scaffold**

- Delete `frontend/src/App.css`
- Delete `frontend/public/vite.svg`
- Delete `frontend/src/assets/` directory
- Replace `frontend/src/App.tsx` with placeholder:

```tsx
export default function App() {
  return (
    <div className="min-h-screen bg-bg text-text-primary font-sans">
      <p className="text-center pt-20 text-2xl font-bold">DevSOL</p>
    </div>
  );
}
```

- Replace `frontend/src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

**Step 6: Verify it runs**

```bash
cd /Users/rector/local-dev/devsol/frontend && pnpm dev
```

Expected: Opens on `localhost:5173`, dark background, "DevSOL" text centered.

**Step 7: Add to .gitignore**

Ensure root `.gitignore` has `frontend/node_modules/` (Vite scaffold creates its own .gitignore which should already cover this).

**Step 8: Commit**

```bash
cd /Users/rector/local-dev/devsol
git add frontend/
git commit -m "feat: scaffold frontend with Vite + React + Tailwind v4"
```

---

### Task 4: API client + types

**Files:**
- Create: `frontend/src/api.ts`
- Create: `frontend/src/types.ts`

**Step 1: Create shared types**

Create `frontend/src/types.ts`:

```typescript
export interface Transaction {
  id: string;
  type: 'buy' | 'sell';
  wallet: string;
  sol_amount: number;
  usdc_amount: number;
  status: 'pending' | 'completed' | 'failed' | 'refunded' | 'expired';
  created_at: string;
  memo?: string;
  mainnet_tx?: string;
  devnet_tx?: string;
}

export interface BuyResponse {
  transaction_id: string;
  status: string;
  deposit_address: string;
  memo: string;
  amount_sol: number;
  usdc_cost: number;
  instructions: string;
}

export interface SellResponse {
  transaction_id: string;
  status: string;
  deposit_address: string;
  memo: string;
  amount_sol: number;
  usdc_payout: number;
  instructions: string;
}

export interface PriceSummary {
  buy: { sol_per_usdc: number; usdc_per_sol: number };
  sell: { sol_per_usdc: number; usdc_per_sol: number };
  spread: number;
}

export interface PlatformStats {
  total_trades: number;
  completed_trades: number;
  pending_orders: number;
  success_rate: number;
  buy_rate: number;
  sell_rate: number;
  spread: number;
  network_fees: string;
}

export interface HealthDetail {
  treasury_sol: number;
  payout_usdc: number;
  payout_wallet: string;
  pending_orders: number;
}

export interface RecentTransaction {
  id: string;
  type: string;
  wallet: string;
  sol_amount: number;
  usdc_amount: number;
  status: string;
  created_at: string;
}
```

**Step 2: Create API client**

Create `frontend/src/api.ts`:

```typescript
import type { BuyResponse, SellResponse, PriceSummary, PlatformStats, HealthDetail, Transaction, RecentTransaction } from './types';

const BASE = import.meta.env.VITE_API_URL || '/api';

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  getPrice: () => fetchJson<PriceSummary>('/price'),
  getStats: () => fetchJson<PlatformStats>('/stats'),
  getHealthDetail: () => fetchJson<HealthDetail>('/health/detail'),
  getRecentTx: () => fetchJson<{ transactions: RecentTransaction[] }>('/tx/recent'),
  getTx: (id: string) => fetchJson<Transaction>(`/tx/${id}`),
  buy: (wallet: string, amount_sol: number) =>
    fetchJson<BuyResponse>('/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet, amount_sol }),
    }),
  sell: (wallet: string, amount_sol: number) =>
    fetchJson<SellResponse>('/sell', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet, amount_sol }),
    }),
};
```

**Step 3: Commit**

```bash
git add frontend/src/api.ts frontend/src/types.ts
git commit -m "feat: add API client and TypeScript types for frontend"
```

---

### Task 5: Wallet provider setup

**Files:**
- Create: `frontend/src/WalletProvider.tsx`
- Modify: `frontend/src/main.tsx`

**Step 1: Create wallet provider**

Create `frontend/src/WalletProvider.tsx`:

```tsx
import { useMemo, type ReactNode } from 'react';
import { ConnectionProvider, WalletProvider as SolanaWalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import '@solana/wallet-adapter-react-ui/styles.css';

const MAINNET_RPC = import.meta.env.VITE_MAINNET_RPC || 'https://api.mainnet-beta.solana.com';

export function WalletProvider({ children }: { children: ReactNode }) {
  const wallets = useMemo(() => [], []); // Wallet Standard auto-detects installed wallets
  return (
    <ConnectionProvider endpoint={MAINNET_RPC}>
      <SolanaWalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
}
```

**Step 2: Wrap App in WalletProvider**

Update `frontend/src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { WalletProvider } from './WalletProvider';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WalletProvider>
      <App />
    </WalletProvider>
  </StrictMode>,
);
```

**Step 3: Verify wallet modal works**

```bash
cd /Users/rector/local-dev/devsol/frontend && pnpm dev
```

Add a temporary `<WalletMultiButton />` in App to verify the modal renders. Remove after verification.

**Step 4: Commit**

```bash
git add frontend/src/WalletProvider.tsx frontend/src/main.tsx
git commit -m "feat: add Solana wallet adapter provider with auto-detect"
```

---

### Task 6: Build the Buy/Sell Widget component

**Files:**
- Create: `frontend/src/components/Widget.tsx`
- Create: `frontend/src/hooks/useQuote.ts`
- Create: `frontend/src/hooks/useTxPoller.ts`
- Modify: `frontend/src/App.tsx`

**Step 1: Create quote hook**

Create `frontend/src/hooks/useQuote.ts`:

```typescript
import { useState, useEffect } from 'react';
import { api } from '../api';
import type { PriceSummary } from '../types';

export function useQuote() {
  const [prices, setPrices] = useState<PriceSummary | null>(null);

  useEffect(() => {
    api.getPrice().then(setPrices).catch(console.error);
    const interval = setInterval(() => {
      api.getPrice().then(setPrices).catch(console.error);
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  function getBuyQuote(solAmount: number) {
    if (!prices || solAmount <= 0) return null;
    return { sol: solAmount, usdc: Math.round(solAmount * prices.buy.usdc_per_sol * 1_000_000) / 1_000_000 };
  }

  function getSellQuote(solAmount: number) {
    if (!prices || solAmount <= 0) return null;
    return { sol: solAmount, usdc: Math.round(solAmount * prices.sell.usdc_per_sol * 1_000_000) / 1_000_000 };
  }

  return { prices, getBuyQuote, getSellQuote };
}
```

**Step 2: Create tx polling hook**

Create `frontend/src/hooks/useTxPoller.ts`:

```typescript
import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import type { Transaction } from '../types';

export function useTxPoller() {
  const [txId, setTxId] = useState<string | null>(null);
  const [tx, setTx] = useState<Transaction | null>(null);
  const [polling, setPolling] = useState(false);

  const startPolling = useCallback((id: string) => {
    setTxId(id);
    setTx(null);
    setPolling(true);
  }, []);

  const reset = useCallback(() => {
    setTxId(null);
    setTx(null);
    setPolling(false);
  }, []);

  useEffect(() => {
    if (!txId || !polling) return;
    let cancelled = false;

    const poll = async () => {
      while (!cancelled) {
        try {
          const result = await api.getTx(txId);
          if (cancelled) return;
          setTx(result);
          if (result.status !== 'pending') {
            setPolling(false);
            return;
          }
        } catch {
          // Continue polling on error
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
    };

    poll();
    return () => { cancelled = true; };
  }, [txId, polling]);

  return { tx, polling, startPolling, reset };
}
```

**Step 3: Create the Widget component**

Create `frontend/src/components/Widget.tsx`. This is the core component — it handles:
- Tab switching (Buy/Sell)
- Amount input with live quote
- Wallet connection via adapter
- Transaction submission (creates order → sends on-chain tx with memo → polls status)
- Status display

The component is large (~200 lines). Implement matching the Pencil mockup design:
- Dark card (`bg-card-bg border border-card-border rounded-default`)
- Header: "DevSOL" logo + `<WalletMultiButton />`
- Tabs: Buy (purple active) / Sell (green active)
- Amount input section → Arrow divider → Quote display
- Action button (purple for buy, accent for sell)
- Footer with "Secured by Solana" + "Expires in 30 min"

For the transaction sending logic:
1. Call `api.buy()` or `api.sell()` to create the order
2. Get `deposit_address` + `memo` from response
3. Build a Solana transaction:
   - **Buy:** Transfer USDC to `deposit_address` with memo instruction (mainnet)
   - **Sell:** Transfer SOL to `deposit_address` with memo instruction (devnet — need separate connection)
4. Sign and send via wallet adapter
5. Poll `GET /tx/:id` until terminal status

**Important implementation notes:**
- Buy flow sends USDC on **mainnet** — the wallet adapter connection must be mainnet
- Sell flow sends SOL on **devnet** — requires a separate `Connection` object to devnet RPC
- The memo program ID is `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`
- Wallet adapter's `sendTransaction` handles signing

**Step 4: Wire Widget into App**

Update `frontend/src/App.tsx` to render the Widget component centered on the page.

**Step 5: Test manually in browser**

```bash
cd /Users/rector/local-dev/devsol/frontend && pnpm dev
```

Verify: Dark theme, wallet connect, tab switching, amount input updates quote.

**Step 6: Commit**

```bash
git add frontend/src/components/Widget.tsx frontend/src/hooks/useQuote.ts frontend/src/hooks/useTxPoller.ts frontend/src/App.tsx
git commit -m "feat: build buy/sell widget with wallet adapter and tx polling"
```

---

### Task 7: Transaction Status component

**Files:**
- Create: `frontend/src/components/TxStatus.tsx`

**Step 1: Create component**

Matches the "DevSOL - Transaction Status" screen in Pencil mockup:
- Green checkmark (completed), purple loader (pending), red X (failed/expired)
- Detail rows: Type, Paid, Received, Status badge
- "View on Solana Explorer" link (opens `https://explorer.solana.com/tx/{sig}?cluster=devnet` or mainnet)
- "New Order" button to reset

```tsx
import type { Transaction } from '../types';

interface TxStatusProps {
  tx: Transaction;
  polling: boolean;
  onReset: () => void;
}

export function TxStatus({ tx, polling, onReset }: TxStatusProps) {
  const isComplete = tx.status === 'completed';
  const isFailed = tx.status === 'failed' || tx.status === 'expired';
  const explorerSig = tx.type === 'buy' ? tx.devnet_tx : tx.mainnet_tx;
  const explorerCluster = tx.type === 'buy' ? '?cluster=devnet' : '';

  return (
    <div className="w-full flex flex-col items-center gap-6 p-6">
      {/* Status icon */}
      <div className={`w-16 h-16 rounded-full flex items-center justify-center ${
        isComplete ? 'bg-accent/10' : isFailed ? 'bg-red-500/10' : 'bg-primary/10'
      }`}>
        {polling ? '⏳' : isComplete ? '✓' : '✗'}
      </div>

      <h2 className={`text-xl font-bold ${
        isComplete ? 'text-accent' : isFailed ? 'text-red-400' : 'text-primary'
      }`}>
        {polling ? 'Processing...' : isComplete ? 'Transaction Complete' : `Transaction ${tx.status}`}
      </h2>

      {/* Detail rows */}
      <div className="w-full rounded-sm bg-input-bg border border-input-border">
        <DetailRow label="Type" value={tx.type === 'buy' ? 'Buy' : 'Sell'} />
        <DetailRow label="Paid" value={tx.type === 'buy' ? `${tx.usdc_amount} USDC` : `${tx.sol_amount} SOL`} />
        <DetailRow label="Received" value={tx.type === 'buy' ? `${tx.sol_amount} SOL` : `${tx.usdc_amount} USDC`} accent />
        <DetailRow label="Status" badge={tx.status} />
      </div>

      {/* Explorer link */}
      {explorerSig && (
        <a href={`https://explorer.solana.com/tx/${explorerSig}${explorerCluster}`}
           target="_blank" rel="noopener noreferrer"
           className="w-full h-11 rounded-sm bg-card-border flex items-center justify-center gap-2 text-text-secondary text-sm hover:text-text-primary transition">
          View on Solana Explorer ↗
        </a>
      )}

      <button onClick={onReset}
              className="w-full h-12 rounded-sm bg-primary text-white font-semibold hover:bg-primary/90 transition">
        New Order
      </button>
    </div>
  );
}

function DetailRow({ label, value, accent, badge }: { label: string; value?: string; accent?: boolean; badge?: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-input-border last:border-0">
      <span className="text-sm text-text-secondary">{label}</span>
      {badge ? (
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
          badge === 'completed' ? 'bg-accent/10 text-accent' :
          badge === 'pending' ? 'bg-primary/10 text-primary' :
          'bg-red-500/10 text-red-400'
        }`}>{badge.charAt(0).toUpperCase() + badge.slice(1)}</span>
      ) : (
        <span className={`text-sm font-semibold ${accent ? 'text-accent' : 'text-text-primary'}`}>{value}</span>
      )}
    </div>
  );
}
```

**Step 2: Integrate into Widget flow**

When `useTxPoller` returns a non-null `tx`, show `<TxStatus>` instead of the form.

**Step 3: Commit**

```bash
git add frontend/src/components/TxStatus.tsx
git commit -m "feat: add transaction status component with explorer links"
```

---

### Task 8: Treasury Stats + Trust Indicators section

**Files:**
- Create: `frontend/src/components/TreasuryStats.tsx`
- Create: `frontend/src/components/TrustIndicators.tsx`
- Create: `frontend/src/hooks/useStats.ts`

**Step 1: Create stats hook**

Create `frontend/src/hooks/useStats.ts`:

```typescript
import { useState, useEffect } from 'react';
import { api } from '../api';
import type { PlatformStats, HealthDetail } from '../types';

export function useStats() {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [health, setHealth] = useState<HealthDetail | null>(null);

  useEffect(() => {
    const fetch = () => {
      api.getStats().then(setStats).catch(console.error);
      api.getHealthDetail().then(setHealth).catch(console.error);
    };
    fetch();
    const interval = setInterval(fetch, 30_000);
    return () => clearInterval(interval);
  }, []);

  return { stats, health };
}
```

**Step 2: Create TreasuryStats component**

Matches the stats bar in the mockup — 4 columns: Treasury SOL, Payout Reserves, Total Trades, Pending Orders.

**Step 3: Create TrustIndicators component**

Matches the "Platform Transparency" section in the mockup — 4 cards in 2x2 grid:
1. Proof of Reserves (explorer links to `DSoLG...PoAt` devnet, `Pay85...Hjx` mainnet)
2. Performance (success rate, avg fulfillment, uptime)
3. Fee Transparency (buy/sell spread, "we cover gas")
4. Open Source (GitHub link + star CTA)

Wallet addresses are hardcoded from config (known public addresses).

**Step 4: Commit**

```bash
git add frontend/src/components/TreasuryStats.tsx frontend/src/components/TrustIndicators.tsx frontend/src/hooks/useStats.ts
git commit -m "feat: add treasury stats and trust indicators sections"
```

---

### Task 9: Recent Transactions feed

**Files:**
- Create: `frontend/src/components/TxFeed.tsx`
- Create: `frontend/src/hooks/useRecentTx.ts`

**Step 1: Create recent tx hook**

Create `frontend/src/hooks/useRecentTx.ts`:

```typescript
import { useState, useEffect } from 'react';
import { api } from '../api';
import type { RecentTransaction } from '../types';

export function useRecentTx() {
  const [transactions, setTransactions] = useState<RecentTransaction[]>([]);

  useEffect(() => {
    const fetch = () => api.getRecentTx().then((r) => setTransactions(r.transactions)).catch(console.error);
    fetch();
    const interval = setInterval(fetch, 15_000);
    return () => clearInterval(interval);
  }, []);

  return transactions;
}
```

**Step 2: Create TxFeed component**

Matches the "Recent Transactions" panel in the mockup:
- Header: "Recent Transactions" + green "Live" badge
- Rows: type icon (purple arrow for buy, green arrow for sell), wallet (truncated), amount, timestamp
- Pending rows show a "Pending" badge instead of the amount

**Step 3: Commit**

```bash
git add frontend/src/components/TxFeed.tsx frontend/src/hooks/useRecentTx.ts
git commit -m "feat: add live transaction feed component"
```

---

### Task 10: Full page layout assembly

**Files:**
- Modify: `frontend/src/App.tsx`
- Create: `frontend/src/components/Header.tsx`
- Create: `frontend/src/components/Footer.tsx`

**Step 1: Create Header**

Matches mockup: "DevSOL" logo + "Devnet SOL Marketplace" tagline + GitHub link.

**Step 2: Create Footer**

Simple footer with links.

**Step 3: Assemble full page**

Update `frontend/src/App.tsx` to compose:
```
<Header />
<TreasuryStats />
<TrustIndicators />
<div className="flex gap-6 max-w-[900px] mx-auto">
  <Widget />      {/* 420px */}
  <TxFeed />      {/* fill remaining */}
</div>
<Footer />
```

**Step 4: Verify full page renders correctly**

```bash
cd /Users/rector/local-dev/devsol/frontend && pnpm dev
```

Compare against Pencil mockup. Adjust spacing/sizes as needed.

**Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/Header.tsx frontend/src/components/Footer.tsx
git commit -m "feat: assemble full page layout with all sections"
```

---

### Task 11: Build + deploy config

**Files:**
- Modify: `frontend/vite.config.ts` (production API URL)
- Create: `frontend/.env.production`
- Modify: `.github/workflows/deploy.yml`
- Modify: VPS nginx config

**Step 1: Create production env**

Create `frontend/.env.production`:
```
VITE_API_URL=https://api.devsol.rectorspace.com
VITE_MAINNET_RPC=https://api.mainnet-beta.solana.com
```

**Step 2: Build and verify**

```bash
cd /Users/rector/local-dev/devsol/frontend
pnpm build
```

Expected: `frontend/dist/` with `index.html`, JS, CSS bundles.

**Step 3: Update deploy workflow**

Extend `.github/workflows/deploy.yml` to:
1. `cd frontend && pnpm install && pnpm build`
2. SCP `frontend/dist/` to VPS at `/var/www/devsol/`
3. Nginx serves static files at `devsol.rectorspace.com`

**Step 4: Nginx config on VPS**

```nginx
server {
    server_name devsol.rectorspace.com;
    root /var/www/devsol;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # API proxy
    location /api/ {
        proxy_pass http://localhost:3100/;
    }
}
```

Note: With nginx proxying `/api/` to the backend, the frontend's `VITE_API_URL` can be `/api` in production too, simplifying CORS. Update `DEVSOL_CORS_ORIGIN` in the backend's `.env` to `https://devsol.rectorspace.com`.

**Step 5: Commit**

```bash
git add frontend/.env.production frontend/vite.config.ts .github/workflows/deploy.yml
git commit -m "feat: add frontend build and deploy configuration"
```

---

## Track C: Hosted Skill

### Task 12: Create `skill.md` for AI agents

**Files:**
- Create: `frontend/public/skill.md`

**Step 1: Write the skill file**

Create `frontend/public/skill.md` — this gets served statically at `devsol.rectorspace.com/skill.md`:

```markdown
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
```

**Step 2: Verify it's served**

After build: `curl https://devsol.rectorspace.com/skill.md` should return the markdown.

**Step 3: Commit**

```bash
git add frontend/public/skill.md
git commit -m "feat: add hosted skill.md for AI agent instructions"
```

---

## Execution Order

```
Track A (Backend):  Task 1 → Task 2
Track B (Frontend): Task 3 → Task 4 → Task 5 → Task 6 → Task 7 → Task 8 → Task 9 → Task 10 → Task 11
Track C (Skill):    Task 12

Track A and Track B can run in parallel.
Track C depends on Task 11 (needs frontend/public/ to exist).
```

## Verification Checklist

After all tasks complete:

- [ ] `pnpm test:run` — all backend tests pass (existing + new)
- [ ] `pnpm exec tsc --noEmit` — backend type-check clean
- [ ] `cd frontend && pnpm build` — frontend builds cleanly
- [ ] Local: frontend on `:5173` proxies to backend on `:3100` correctly
- [ ] `GET /stats` returns trade counts and rates
- [ ] `GET /tx/recent` returns truncated wallet addresses
- [ ] Widget: connect wallet, create buy order, see status polling
- [ ] Trust section: all 4 cards render with live data
- [ ] Transaction feed: shows recent trades
- [ ] `devsol.rectorspace.com/skill.md` serves the agent instructions
- [ ] Deploy to VPS, verify production

## API Endpoint Summary (After Phase 2)

| Method | Path | New? | Description |
|--------|------|------|-------------|
| GET | `/health` | No | Basic health |
| GET | `/health/detail` | No | Treasury + payout balances |
| GET | `/price` | No | Buy/sell rates |
| GET | `/treasury` | No | Treasury address + balance |
| GET | `/stats` | **Yes** | Platform stats (counts, rates, success rate) |
| GET | `/tx/recent` | **Yes** | Last 10 transactions (wallet truncated) |
| GET | `/tx/:id` | No | Transaction lookup |
| POST | `/buy` | No | Create buy order |
| POST | `/sell` | No | Create sell order |
