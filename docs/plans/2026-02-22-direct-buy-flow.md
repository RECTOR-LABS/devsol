# Direct Payment Buy Flow — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace x402-based buy flow with deposit-based flow where users send mainnet USDC with a memo, and a detector delivers devnet SOL.

**Architecture:** Mirror the sell flow. `POST /buy` returns deposit instructions (address, memo, USDC amount). `BuyDepositDetector` polls the payout wallet's USDC ATA on mainnet for incoming transfers, matches by memo, calls `handleBuyDeposit` to deliver devnet SOL or refund.

**Tech Stack:** @solana/kit, @solana-program/token, better-sqlite3, Hono, Vitest

---

### Task 1: Add `findPendingBuys()` and `atomicCompleteBuy()` to TransactionDB

**Files:**
- Modify: `src/db/sqlite.ts`
- Test: `src/db/sqlite.test.ts`

**Step 1: Write the failing tests**

Add to `src/db/sqlite.test.ts`:

```typescript
it('findPendingBuys returns only pending buy orders', () => {
  db.create({ type: 'buy', wallet: 'abc', sol_amount: 1, usdc_amount: 1.05 });
  db.create({ type: 'sell', wallet: 'def', sol_amount: 2, usdc_amount: 1.9 });
  db.create({ type: 'buy', wallet: 'ghi', sol_amount: 3, usdc_amount: 3.15 });
  db.update(db.create({ type: 'buy', wallet: 'jkl', sol_amount: 1, usdc_amount: 1.05 }).id, { status: 'completed' });

  const pending = db.findPendingBuys();
  expect(pending).toHaveLength(2);
  expect(pending.every(tx => tx.type === 'buy' && tx.status === 'pending')).toBe(true);
});

it('atomicCompleteBuy sets mainnet_tx and status completed', () => {
  const tx = db.create({ type: 'buy', wallet: 'abc', sol_amount: 1, usdc_amount: 1.05, memo: 'devsol-buy1' });
  const result = db.atomicCompleteBuy(tx.id, 'mainnet_sig_123');
  expect(result).not.toBeNull();
  expect(result!.status).toBe('completed');
  expect(result!.mainnet_tx).toBe('mainnet_sig_123');
});

it('atomicCompleteBuy returns null for already-completed buy', () => {
  const tx = db.create({ type: 'buy', wallet: 'abc', sol_amount: 1, usdc_amount: 1.05 });
  db.update(tx.id, { status: 'completed' });
  const result = db.atomicCompleteBuy(tx.id, 'sig');
  expect(result).toBeNull();
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm test:run src/db/sqlite.test.ts`
Expected: FAIL — `findPendingBuys` and `atomicCompleteBuy` not defined

**Step 3: Implement**

Add to `src/db/sqlite.ts` in the `TransactionDB` class:

```typescript
findPendingBuys(): Transaction[] {
  return this.db
    .prepare("SELECT * FROM transactions WHERE type = 'buy' AND status = 'pending'")
    .all() as Transaction[];
}

atomicCompleteBuy(id: string, mainnetSig: string): Transaction | null {
  const result = this.db.prepare(
    "UPDATE transactions SET status = 'completed', mainnet_tx = ?, updated_at = datetime('now') WHERE id = ? AND status = 'pending'"
  ).run(mainnetSig, id);
  if (result.changes === 0) return null;
  return this.getById(id);
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm test:run src/db/sqlite.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/db/sqlite.ts src/db/sqlite.test.ts
git commit -m "feat: add findPendingBuys and atomicCompleteBuy to TransactionDB"
```

---

### Task 2: Create `handleBuyDeposit` callback

**Files:**
- Create: `src/buy-deposit-handler.ts`
- Create: `src/buy-deposit-handler.test.ts`

**Step 1: Write the failing tests**

Create `src/buy-deposit-handler.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { handleBuyDeposit } from './buy-deposit-handler.js';
import type { Transaction } from './db/sqlite.js';

function makeTx(overrides?: Partial<Transaction>): Transaction {
  return {
    id: 'buy-1', type: 'buy', wallet: 'BuyerWallet', sol_amount: 1,
    usdc_amount: 1.05, mainnet_tx: 'mainnet_sig', devnet_tx: null,
    mainnet_payout_tx: null, memo: 'devsol-buy1', status: 'completed',
    created_at: '', updated_at: '', ...overrides,
  };
}

describe('handleBuyDeposit', () => {
  it('delivers devnet SOL on successful buy', async () => {
    const treasury = { sendSol: vi.fn(async () => 'devnet_sig'), getBalance: vi.fn(async () => 100) };
    const payout = { sendUsdc: vi.fn(), canAffordPayout: vi.fn() };
    const db = { update: vi.fn() };
    const tx = makeTx();

    await handleBuyDeposit(tx, 'mainnet_deposit_sig', { treasury, payout, db });

    expect(treasury.sendSol).toHaveBeenCalledWith('BuyerWallet', 1);
    expect(db.update).toHaveBeenCalledWith('buy-1', { devnet_tx: 'devnet_sig' });
  });

  it('refunds USDC when treasury delivery fails', async () => {
    const treasury = { sendSol: vi.fn(async () => { throw new Error('no SOL'); }), getBalance: vi.fn(async () => 100) };
    const payout = { sendUsdc: vi.fn(async () => 'refund_sig'), canAffordPayout: vi.fn() };
    const db = { update: vi.fn() };
    const tx = makeTx();

    await handleBuyDeposit(tx, 'mainnet_deposit_sig', { treasury, payout, db });

    expect(payout.sendUsdc).toHaveBeenCalledWith('BuyerWallet', 1.05);
    expect(db.update).toHaveBeenCalledWith('buy-1', { status: 'refunded' });
  });

  it('sets status failed when both delivery and refund fail', async () => {
    const treasury = { sendSol: vi.fn(async () => { throw new Error('fail'); }), getBalance: vi.fn(async () => 100) };
    const payout = { sendUsdc: vi.fn(async () => { throw new Error('refund fail'); }), canAffordPayout: vi.fn() };
    const db = { update: vi.fn() };
    const tx = makeTx();

    await handleBuyDeposit(tx, 'sig', { treasury, payout, db });

    expect(db.update).toHaveBeenCalledWith('buy-1', { status: 'failed' });
  });

  it('logs warning when no payout service for refund', async () => {
    const treasury = { sendSol: vi.fn(async () => { throw new Error('fail'); }), getBalance: vi.fn(async () => 100) };
    const db = { update: vi.fn() };
    const tx = makeTx();
    const consoleSpy = vi.spyOn(console, 'error');

    await handleBuyDeposit(tx, 'sig', { treasury, db });

    expect(db.update).toHaveBeenCalledWith('buy-1', { status: 'failed' });
    consoleSpy.mockRestore();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm test:run src/buy-deposit-handler.test.ts`
Expected: FAIL — module not found

**Step 3: Implement**

Create `src/buy-deposit-handler.ts`:

```typescript
import type { Transaction, UpdateTransactionInput } from './db/sqlite.js';

interface BuyDepositDeps {
  treasury: {
    sendSol(recipient: string, solAmount: number): Promise<string>;
    getBalance(): Promise<number>;
  };
  payout?: {
    sendUsdc(recipient: string, usdcAmount: number): Promise<string>;
  };
  db: {
    update(id: string, data: UpdateTransactionInput): void;
  };
}

export async function handleBuyDeposit(
  tx: Transaction,
  mainnetSig: string,
  deps: BuyDepositDeps,
): Promise<void> {
  console.log(`USDC deposit confirmed for buy ${tx.id}: ${mainnetSig}`);

  try {
    const devnetSig = await deps.treasury.sendSol(tx.wallet, tx.sol_amount);
    deps.db.update(tx.id, { devnet_tx: devnetSig });
    console.log(`Devnet SOL delivered for buy ${tx.id}: ${devnetSig}`);
  } catch (err) {
    console.error(`Devnet SOL delivery failed for buy ${tx.id}:`, err);

    if (!deps.payout) {
      console.error(`No payout service — cannot refund USDC for buy ${tx.id}`);
      deps.db.update(tx.id, { status: 'failed' });
      return;
    }

    try {
      const refundSig = await deps.payout.sendUsdc(tx.wallet, tx.usdc_amount);
      deps.db.update(tx.id, { status: 'refunded' });
      console.log(`Refunded ${tx.usdc_amount} USDC to ${tx.wallet}: ${refundSig}`);
    } catch (refundErr) {
      console.error(`CRITICAL: USDC refund also failed for buy ${tx.id}:`, refundErr);
      deps.db.update(tx.id, { status: 'failed' });
    }
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm test:run src/buy-deposit-handler.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/buy-deposit-handler.ts src/buy-deposit-handler.test.ts
git commit -m "feat: add handleBuyDeposit callback for devnet SOL delivery"
```

---

### Task 3: Create `BuyDepositDetector`

**Files:**
- Create: `src/services/buy-deposit.ts`
- Create: `src/services/buy-deposit.test.ts`

**Step 1: Write the failing tests**

Create `src/services/buy-deposit.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BuyDepositDetector } from './buy-deposit.js';
import { TransactionDB } from '../db/sqlite.js';

describe('BuyDepositDetector', () => {
  let db: TransactionDB;
  const mockRpc = {
    getSignaturesForAddress: vi.fn(() => ({
      send: vi.fn(async () => []),
    })),
  };

  beforeEach(() => {
    db = new TransactionDB(':memory:');
    vi.clearAllMocks();
  });

  afterEach(() => db.close());

  it('polls and matches buy deposits by memo', async () => {
    const onDeposit = vi.fn();
    const tx = db.create({
      type: 'buy', wallet: 'buyer1', sol_amount: 1, usdc_amount: 1.05, memo: 'devsol-buy1',
    });

    const mockRpcWithDeposit = {
      getSignaturesForAddress: vi.fn(() => ({
        send: vi.fn(async () => [
          { memo: '[15] devsol-buy1', signature: 'mainnet_usdc_sig' },
        ]),
      })),
    };

    const detector = new BuyDepositDetector({
      db, rpc: mockRpcWithDeposit as any, usdcAtaAddress: 'UsdcAta', onDeposit,
    });

    await detector.poll();
    expect(onDeposit).toHaveBeenCalledWith(
      expect.objectContaining({ id: tx.id, status: 'completed' }),
      'mainnet_usdc_sig',
    );
  });

  it('skips already-completed buys', async () => {
    const onDeposit = vi.fn();
    const tx = db.create({
      type: 'buy', wallet: 'buyer1', sol_amount: 1, usdc_amount: 1.05, memo: 'devsol-done',
    });
    db.update(tx.id, { status: 'completed' });

    const detector = new BuyDepositDetector({
      db, rpc: mockRpc as any, usdcAtaAddress: 'UsdcAta', onDeposit,
    });

    await detector.processDeposit(tx.id, 'some_sig');
    expect(onDeposit).not.toHaveBeenCalled();
  });

  it('strips RPC memo prefix before matching', async () => {
    const onDeposit = vi.fn();
    const tx = db.create({
      type: 'buy', wallet: 'buyer1', sol_amount: 1, usdc_amount: 1.05, memo: 'devsol-strip1',
    });

    const mockRpcPrefix = {
      getSignaturesForAddress: vi.fn(() => ({
        send: vi.fn(async () => [
          { memo: '[16] devsol-strip1', signature: 'prefix_sig' },
        ]),
      })),
    };

    const detector = new BuyDepositDetector({
      db, rpc: mockRpcPrefix as any, usdcAtaAddress: 'UsdcAta', onDeposit,
    });

    await detector.poll();
    expect(onDeposit).toHaveBeenCalledWith(
      expect.objectContaining({ id: tx.id }),
      'prefix_sig',
    );
  });

  it('does not match sell orders', async () => {
    const onDeposit = vi.fn();
    db.create({ type: 'sell', wallet: 'seller1', sol_amount: 1, usdc_amount: 0.95, memo: 'devsol-sell1' });

    const mockRpcSell = {
      getSignaturesForAddress: vi.fn(() => ({
        send: vi.fn(async () => [
          { memo: 'devsol-sell1', signature: 'sell_sig' },
        ]),
      })),
    };

    const detector = new BuyDepositDetector({
      db, rpc: mockRpcSell as any, usdcAtaAddress: 'UsdcAta', onDeposit,
    });

    await detector.poll();
    expect(onDeposit).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm test:run src/services/buy-deposit.test.ts`
Expected: FAIL — module not found

**Step 3: Implement**

Create `src/services/buy-deposit.ts`:

```typescript
import type { TransactionDB, Transaction } from '../db/sqlite.js';

interface SolanaRpc {
  getSignaturesForAddress(address: any, opts: any): {
    send(): Promise<Array<{ memo: string | null; signature: string }>>;
  };
}

interface BuyDepositConfig {
  db: TransactionDB;
  rpc: SolanaRpc;
  usdcAtaAddress: string;
  onDeposit: (tx: Transaction, mainnetSig: string) => void | Promise<void>;
  pollIntervalMs?: number;
  signatureFetchLimit?: number;
}

export class BuyDepositDetector {
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(private cfg: BuyDepositConfig) {}

  start() {
    const intervalMs = this.cfg.pollIntervalMs ?? 15_000;
    this.interval = setInterval(() => {
      this.poll().catch((err) => console.error('Buy deposit poll fatal:', err));
    }, intervalMs);
    console.log(`Buy deposit detector started (polling every ${intervalMs}ms)`);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async poll() {
    const pendingBuys = this.cfg.db.findPendingBuys();
    if (pendingBuys.length === 0) return;

    try {
      const sigs = await this.cfg.rpc
        .getSignaturesForAddress(this.cfg.usdcAtaAddress, { limit: this.cfg.signatureFetchLimit ?? 50 })
        .send();

      for (const sig of sigs) {
        if (sig.memo && sig.memo.trim()) {
          const rawMemo = sig.memo.trim();
          const cleanMemo = rawMemo.replace(/^\[\d+\]\s*/, '');
          if (!cleanMemo) continue;
          const matching = pendingBuys.find((tx) => tx.memo && cleanMemo === tx.memo);
          if (matching) {
            await this.processDeposit(matching.id, sig.signature);
          }
        }
      }
    } catch (err) {
      console.error('Buy deposit poll error:', err);
    }
  }

  async processDeposit(txId: string, mainnetSig: string) {
    const tx = this.cfg.db.atomicCompleteBuy(txId, mainnetSig);
    if (!tx) return;
    await this.cfg.onDeposit(tx, mainnetSig);
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm test:run src/services/buy-deposit.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/services/buy-deposit.ts src/services/buy-deposit.test.ts
git commit -m "feat: add BuyDepositDetector for mainnet USDC deposit matching"
```

---

### Task 4: Rewrite `POST /buy` route to deposit-based flow

**Files:**
- Modify: `src/routes/buy.ts`
- Modify: `src/routes/buy.test.ts`

**Step 1: Rewrite the tests**

Replace `src/routes/buy.test.ts` content entirely. The new route no longer depends on x402. It mirrors sell: returns deposit instructions.

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { buyRoutes } from './buy.js';
import { TransactionDB } from '../db/sqlite.js';
import { PricingService } from '../services/pricing.js';

describe('POST /buy', () => {
  let db: TransactionDB;
  let app: Hono;
  const mockTreasury = { getBalance: vi.fn(async () => 1000), address: 'TreasuryAddr', sendSol: vi.fn() };

  beforeEach(() => {
    db = new TransactionDB(':memory:');
    vi.clearAllMocks();
    const pricing = new PricingService(1.05, 0.95);
    app = new Hono();
    app.route('/', buyRoutes({ db, pricing, treasury: mockTreasury as any, payoutAddress: 'PayoutWallet' }));
  });

  afterEach(() => db.close());

  it('returns deposit instructions for valid buy', async () => {
    const res = await app.request('/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: 'BuyerWa11etXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', amount_sol: 10 }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('pending');
    expect(data.deposit_address).toBe('PayoutWallet');
    expect(data.memo).toMatch(/^devsol-/);
    expect(data.usdc_cost).toBe(10.5);
    expect(data.amount_sol).toBe(10);
    expect(data.transaction_id).toBeDefined();
    expect(data.instructions).toContain('PayoutWallet');
  });

  it('returns 400 for invalid wallet', async () => {
    const res = await app.request('/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: 'bad', amount_sol: 1 }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 503 when treasury has insufficient SOL', async () => {
    mockTreasury.getBalance.mockResolvedValueOnce(0.5);
    const res = await app.request('/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: 'BuyerWa11etXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', amount_sol: 10 }),
    });
    expect(res.status).toBe(503);
  });

  it('creates a pending buy transaction in DB', async () => {
    await app.request('/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: 'BuyerWa11etXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', amount_sol: 5 }),
    });
    const pending = db.findPendingBuys();
    expect(pending).toHaveLength(1);
    expect(pending[0].type).toBe('buy');
    expect(pending[0].sol_amount).toBe(5);
    expect(pending[0].memo).toMatch(/^devsol-/);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm test:run src/routes/buy.test.ts`
Expected: FAIL — buyRoutes signature changed

**Step 3: Rewrite buy route**

Replace `src/routes/buy.ts`:

```typescript
import { Hono } from 'hono';
import { randomUUID } from 'crypto';
import type { TransactionDB } from '../db/sqlite.js';
import type { PricingService } from '../services/pricing.js';
import type { TreasuryService } from '../services/treasury.js';
import { validateBuySellBody } from '../validation.js';

interface BuyDeps {
  db: TransactionDB;
  pricing: PricingService;
  treasury: TreasuryService;
  payoutAddress: string;
}

export function buyRoutes({ db, pricing, treasury, payoutAddress }: BuyDeps) {
  const router = new Hono();

  router.post('/buy', async (c) => {
    const body = await c.req.json().catch(() => null);
    const validated = validateBuySellBody(body);
    if (typeof validated === 'string') {
      return c.json({ error: validated, code: 'INVALID_REQUEST' }, 400);
    }

    const { wallet, amount_sol } = validated;
    const quote = pricing.buyQuote(amount_sol);

    // Balance pre-check
    const balance = await treasury.getBalance();
    if (balance < amount_sol) {
      return c.json({ error: 'Buy temporarily unavailable: insufficient reserves', code: 'INSUFFICIENT_RESERVES' }, 503);
    }

    const memo = `devsol-${randomUUID().slice(0, 8)}`;

    try {
      const tx = db.create({
        type: 'buy',
        wallet,
        sol_amount: amount_sol,
        usdc_amount: quote.usdc_amount,
        memo,
      });

      return c.json({
        transaction_id: tx.id,
        status: 'pending',
        deposit_address: payoutAddress,
        memo,
        amount_sol,
        usdc_cost: quote.usdc_amount,
        instructions: `Send exactly ${quote.usdc_amount} USDC to ${payoutAddress} on Solana mainnet with memo: ${memo}`,
      });
    } catch {
      return c.json({ error: 'Failed to create buy order', code: 'INTERNAL_ERROR' }, 500);
    }
  });

  return router;
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm test:run src/routes/buy.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/routes/buy.ts src/routes/buy.test.ts
git commit -m "feat: rewrite buy route to deposit-based flow, remove x402 dependency"
```

---

### Task 5: Wire everything in `app.ts` and `index.ts`, remove x402

**Files:**
- Modify: `src/app.ts`
- Modify: `src/app.test.ts`
- Modify: `src/index.ts`
- Modify: `src/routes/treasury.ts`
- Modify: `src/routes/treasury.test.ts`
- Modify: `src/config.ts`

**Step 1: Update `app.ts`**

- Remove `X402Service` import and from `AppDeps`
- Change condition from `deps?.treasury && deps?.x402` to `deps?.treasury`
- Update `buyRoutes` call: `buyRoutes({ db, pricing, treasury: deps.treasury, payoutAddress: deps.payout?.walletAddress ?? '' })`
- Remove `x402` from `treasuryRoutes` call — drop facilitator param
- Remove `sellRoutes` `payout` — keep as-is (already correct)

Updated `AppDeps`:
```typescript
interface AppDeps {
  pricing?: PricingService;
  treasury?: TreasuryService;
  db?: TransactionDB;
  payout?: PayoutService;
}
```

Updated route mounting:
```typescript
if (deps?.treasury) {
  // ... strict rate limit middleware unchanged ...

  app.route('/', treasuryRoutes(deps.treasury, deps.payout));
  app.route('/', buyRoutes({ db, pricing, treasury: deps.treasury, payoutAddress: deps.payout?.walletAddress ?? '' }));
  app.route('/', sellRoutes({ db, pricing, treasuryAddress: deps.treasury.address, payout: deps.payout }));
}
```

**Step 2: Update `treasury.ts` route**

Remove facilitator health check entirely:
- Remove `FacilitatorHealth` interface
- Remove 3rd parameter from `treasuryRoutes`
- Remove `facilitator_reachable` from `/health/detail` response

**Step 3: Update `config.ts`**

Remove: `facilitatorUrl`, `svmNetwork` lines.

**Step 4: Update `index.ts`**

- Remove `HTTPFacilitatorClient` and `X402Service` imports
- Remove `facilitator` and `x402` setup
- Remove x402 from `createApp` call
- Add `BuyDepositDetector` import and setup
- Add `handleBuyDeposit` import
- Wire buy deposit detector alongside sell deposit detector

Updated `index.ts` wiring section:
```typescript
import { BuyDepositDetector } from './services/buy-deposit.js';
import { handleBuyDeposit } from './buy-deposit-handler.js';
// ... remove: import { HTTPFacilitatorClient } from '@x402/core/http';
// ... remove: import { X402Service } from './services/x402.js';

// ... in main():
// Remove facilitator + x402 setup

const { app, db } = createApp({ treasury, payout });

// Sell deposit detector (devnet SOL)
const devnetRpc = createSolanaRpc(config.devnetRpc);
const depositDetector = new DepositDetector({
  db, rpc: devnetRpc as any, treasuryAddress: treasury.address,
  onDeposit: (tx, sig) => handleDeposit(tx, sig, { payout, treasury, db }),
});
depositDetector.start();

// Buy deposit detector (mainnet USDC)
if (payout) {
  const mainnetRpc = createSolanaRpc(config.mainnetRpc);
  const [usdcAta] = await findAssociatedTokenPda({
    mint: address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
    owner: address(payout.walletAddress),
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const buyDetector = new BuyDepositDetector({
    db, rpc: mainnetRpc as any, usdcAtaAddress: usdcAta.toString(),
    onDeposit: (tx, sig) => handleBuyDeposit(tx, sig, { treasury, payout, db }),
  });
  buyDetector.start();
}
```

Additional imports needed in `index.ts`:
```typescript
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { address } from '@solana/kit';
```

**Step 5: Update `app.test.ts`**

Remove all x402-related test setup — any test that mocks `x402` should be updated to remove that mock. The `createApp` call in tests should drop the `x402` param.

**Step 6: Update `treasury.test.ts`**

Remove facilitator-related tests (facilitator_reachable assertions, facilitator mock setup). Keep treasury balance and payout tests.

**Step 7: Run all tests**

Run: `pnpm test:run`
Expected: ALL PASS

**Step 8: Type check**

Run: `pnpm exec tsc --noEmit`
Expected: Clean

**Step 9: Commit**

```bash
git add src/app.ts src/app.test.ts src/index.ts src/config.ts src/routes/treasury.ts src/routes/treasury.test.ts
git commit -m "feat: wire BuyDepositDetector, remove x402 from app stack"
```

---

### Task 6: Remove x402 service and dependencies

**Files:**
- Delete: `src/services/x402.ts`
- Delete: `src/services/x402.test.ts`
- Modify: `package.json` (remove deps)

**Step 1: Delete x402 service files**

```bash
rm src/services/x402.ts src/services/x402.test.ts
```

**Step 2: Remove x402 packages**

```bash
pnpm remove @x402/core @x402/hono @x402/svm @x402/fetch @scure/base
```

**Step 3: Run all tests**

Run: `pnpm test:run`
Expected: ALL PASS

**Step 4: Type check**

Run: `pnpm exec tsc --noEmit`
Expected: Clean

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove x402 service and dependencies"
```

---

### Task 7: Update buy E2E test script

**Files:**
- Modify: `scripts/buy-e2e.ts`

**Step 1: Rewrite buy-e2e.ts**

The new flow: POST /buy → get deposit instructions → send mainnet USDC with memo → poll for completion.

```typescript
import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createKeyPairSignerFromBytes,
  address,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  getSignatureFromTransaction,
  sendAndConfirmTransactionFactory,
} from '@solana/kit';
import {
  findAssociatedTokenPda,
  getTransferCheckedInstruction,
  getCreateAssociatedTokenIdempotentInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import { readFileSync } from 'fs';

const API = 'https://devsol.rectorspace.com';
const MAINNET_RPC = 'https://mainnet.helius-rpc.com/?api-key=142fb48a-aa24-4083-99c8-249df5400b30';
const MAINNET_WSS = 'wss://mainnet.helius-rpc.com/?api-key=142fb48a-aa24-4083-99c8-249df5400b30';
const DEVNET_RPC = 'https://api.devnet.solana.com';
const TEST_KEYPAIR = readFileSync(
  `${process.env.HOME}/Documents/secret/devsol/test-user-keypair.json`, 'utf-8',
);
const WALLET = 'BuyhetgWkEQL4fwEZvWLH4zuzTHLDuRGwRKEY21c2z1V';
const AMOUNT_SOL = 0.1;
const USDC_MINT = address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const USDC_DECIMALS = 6;

async function main() {
  console.log('=== DevSOL Buy Flow E2E Test ===\n');

  // Step 1: POST /buy
  console.log('Step 1: Creating buy order...');
  const buyRes = await fetch(`${API}/buy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wallet: WALLET, amount_sol: AMOUNT_SOL }),
  });
  const buyData = await buyRes.json();
  console.log('Buy response:', JSON.stringify(buyData, null, 2));

  if (buyData.status !== 'pending') {
    console.error('FAIL: Expected pending status');
    process.exit(1);
  }

  const { deposit_address, memo, transaction_id, usdc_cost } = buyData;
  console.log(`\nDeposit to: ${deposit_address}`);
  console.log(`Memo: ${memo}`);
  console.log(`USDC cost: ${usdc_cost}`);
  console.log(`TX ID: ${transaction_id}\n`);

  // Step 2: Send mainnet USDC with memo
  console.log('Step 2: Sending mainnet USDC with memo...');
  const rpc = createSolanaRpc(MAINNET_RPC);
  const rpcSub = createSolanaRpcSubscriptions(MAINNET_WSS);
  const signer = await createKeyPairSignerFromBytes(
    new Uint8Array(JSON.parse(TEST_KEYPAIR)),
  );
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions: rpcSub });
  const { getAddMemoInstruction } = await import('@solana-program/memo');

  const recipientAddr = address(deposit_address);
  const [senderAta] = await findAssociatedTokenPda({
    mint: USDC_MINT, owner: signer.address, tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const [recipientAta] = await findAssociatedTokenPda({
    mint: USDC_MINT, owner: recipientAddr, tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  const createAtaIx = getCreateAssociatedTokenIdempotentInstruction({
    payer: signer, ata: recipientAta, owner: recipientAddr, mint: USDC_MINT,
  });
  const transferIx = getTransferCheckedInstruction({
    source: senderAta, mint: USDC_MINT, destination: recipientAta,
    authority: signer, amount: BigInt(Math.round(usdc_cost * 10 ** USDC_DECIMALS)),
    decimals: USDC_DECIMALS,
  });
  const memoIx = getAddMemoInstruction({ memo });

  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions([createAtaIx, transferIx, memoIx], m),
  );

  const signedTx = await signTransactionMessageWithSigners(message);
  const sig = getSignatureFromTransaction(signedTx);
  console.log(`Transaction signature: ${sig}`);

  await sendAndConfirm(signedTx as Parameters<typeof sendAndConfirm>[0], { commitment: 'confirmed' });
  console.log('Mainnet USDC transfer confirmed!\n');

  // Step 3: Poll for devnet SOL delivery
  console.log('Step 3: Waiting for deposit detection and devnet SOL delivery...');
  const maxWait = 120_000;
  const pollInterval = 5_000;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    const txRes = await fetch(`${API}/tx/${transaction_id}`);
    const txData = await txRes.json();
    console.log(`  Status: ${txData.status} (${Math.round((Date.now() - start) / 1000)}s elapsed)`);

    if (txData.status === 'completed' && txData.devnet_tx) {
      console.log('\n=== SUCCESS ===');
      console.log('Buy completed!');
      console.log(`  TX ID: ${txData.id}`);
      console.log(`  USDC paid: ${txData.usdc_amount}`);
      console.log(`  SOL received: ${txData.sol_amount}`);
      console.log(`  Mainnet TX: ${txData.mainnet_tx}`);
      console.log(`  Devnet TX: ${txData.devnet_tx}`);
      process.exit(0);
    }

    if (txData.status === 'refunded' || txData.status === 'failed') {
      console.error(`\nFAIL: Transaction ${txData.status}`);
      console.error(JSON.stringify(txData, null, 2));
      process.exit(1);
    }

    await new Promise((r) => setTimeout(r, pollInterval));
  }

  console.error('\nTIMEOUT: Deposit not detected within 2 minutes');
  process.exit(1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
```

**Step 2: Commit**

```bash
git add scripts/buy-e2e.ts
git commit -m "test: rewrite buy e2e script for direct USDC deposit flow"
```

---

### Task 8: Update CLAUDE.md and design doc

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/plans/2026-02-22-direct-buy-flow-design.md`

Update CLAUDE.md:
- Remove x402 mentions from Stack section
- Update Buy flow description to deposit-based
- Remove `DEVSOL_X402_FACILITATOR_URL` from env vars table
- Add note about BuyDepositDetector

**Commit:**

```bash
git add CLAUDE.md docs/plans/2026-02-22-direct-buy-flow-design.md
git commit -m "docs: update CLAUDE.md and design doc for direct buy flow"
```

---

## Execution Order

1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 (sequential)

Task 5 is the largest — it wires everything and removes x402 from the app layer. Tasks 1-4 are additive (no breaking changes). Task 6 is cleanup. Tasks 7-8 are docs/scripts.

## Verification

- `pnpm test:run` — all tests pass after each task
- `pnpm exec tsc --noEmit` — clean after tasks 5 and 6
- E2E test after deploy (task 7)
