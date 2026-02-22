# Phase 1: Hardening — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harden DevSOL with transaction expiry, deposit amount verification, and structured logging.

**Architecture:** Three independent epics that can be implemented in any order. Each touches different layers: DB/schema (expiry), deposit detectors (amount verification), and cross-cutting (logging). All share the same test/commit pattern.

**Tech Stack:** better-sqlite3, @solana/kit, pino (new dependency), Vitest

---

### Task 1: Add `expires_at` column and expiry status to DB

**Files:**
- Modify: `src/db/sqlite.ts` (schema, queries, new methods)
- Modify: `src/db/sqlite.test.ts` (new tests)

**Step 1: Write failing tests**

Add to `src/db/sqlite.test.ts`:

```typescript
it('creates transaction with expires_at set to 30 minutes from now', () => {
  const tx = db.create({ type: 'buy', wallet: 'abc', sol_amount: 1, usdc_amount: 1.05 });
  expect(tx.expires_at).toBeDefined();
  const expiresAt = new Date(tx.expires_at + 'Z').getTime();
  const now = Date.now();
  // Should be ~30 min from now (allow 5s tolerance)
  expect(expiresAt).toBeGreaterThan(now + 29 * 60_000);
  expect(expiresAt).toBeLessThan(now + 31 * 60_000);
});

it('expireStale marks old pending transactions as expired', () => {
  const tx = db.create({ type: 'sell', wallet: 'abc', sol_amount: 5, usdc_amount: 4.75 });
  // Manually backdate expires_at to the past
  db['db'].prepare("UPDATE transactions SET expires_at = datetime('now', '-1 hour') WHERE id = ?").run(tx.id);
  const count = db.expireStale();
  expect(count).toBe(1);
  expect(db.getById(tx.id)!.status).toBe('expired');
});

it('expireStale does not touch completed/failed/refunded transactions', () => {
  const tx1 = db.create({ type: 'sell', wallet: 'abc', sol_amount: 5, usdc_amount: 4.75 });
  db.update(tx1.id, { status: 'completed' });
  db['db'].prepare("UPDATE transactions SET expires_at = datetime('now', '-1 hour') WHERE id = ?").run(tx1.id);
  const count = db.expireStale();
  expect(count).toBe(0);
});

it('findPendingSells excludes expired transactions', () => {
  db.create({ type: 'sell', wallet: 'abc', sol_amount: 5, usdc_amount: 4.75 });
  const tx2 = db.create({ type: 'sell', wallet: 'def', sol_amount: 3, usdc_amount: 2.85 });
  db['db'].prepare("UPDATE transactions SET expires_at = datetime('now', '-1 hour') WHERE id = ?").run(tx2.id);
  db.expireStale();
  const pending = db.findPendingSells();
  expect(pending).toHaveLength(1);
});

it('findPendingBuys excludes expired transactions', () => {
  db.create({ type: 'buy', wallet: 'abc', sol_amount: 1, usdc_amount: 1.05 });
  const tx2 = db.create({ type: 'buy', wallet: 'def', sol_amount: 2, usdc_amount: 2.10 });
  db['db'].prepare("UPDATE transactions SET expires_at = datetime('now', '-1 hour') WHERE id = ?").run(tx2.id);
  db.expireStale();
  const pending = db.findPendingBuys();
  expect(pending).toHaveLength(1);
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm test:run -- src/db/sqlite.test.ts`
Expected: FAIL — `expires_at` not defined, `expireStale` not a function

**Step 3: Implement schema and methods**

In `src/db/sqlite.ts`:

1. Add `expires_at: string` to the `Transaction` interface.

2. Add `'expired'` to the status union type:
```typescript
status: 'pending' | 'completed' | 'failed' | 'refunded' | 'expired';
```

3. Update `migrate()` — add migration for `expires_at` column and update CHECK constraint:
```typescript
// Add expires_at column if missing
if (!columns.some(c => c.name === 'expires_at')) {
  this.db.exec("ALTER TABLE transactions ADD COLUMN expires_at TEXT DEFAULT (datetime('now', '+30 minutes'))");
}
```

4. Update `create()` — include `expires_at` in the INSERT:
```typescript
const stmt = this.db.prepare(`
  INSERT INTO transactions (id, type, wallet, sol_amount, usdc_amount, mainnet_tx, devnet_tx, memo, expires_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+30 minutes'))
`);
```

5. Add `expireStale()` method:
```typescript
expireStale(): number {
  const result = this.db.prepare(
    "UPDATE transactions SET status = 'expired', updated_at = datetime('now') WHERE status = 'pending' AND expires_at <= datetime('now')"
  ).run();
  return result.changes;
}
```

6. The `findPendingSells`/`findPendingBuys` queries already filter by `status = 'pending'`, so expired transactions (status = 'expired') are automatically excluded. No query changes needed.

**Step 4: Run tests to verify they pass**

Run: `pnpm test:run -- src/db/sqlite.test.ts`
Expected: ALL PASS

**Step 5: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: Clean

**Step 6: Commit**

```bash
git add src/db/sqlite.ts src/db/sqlite.test.ts
git commit -m "feat: add transaction expiry with expires_at column and expireStale()"
```

---

### Task 2: Wire expiry cleanup job in index.ts

**Files:**
- Modify: `src/index.ts` (add interval)

**Step 1: Add cleanup interval to main()**

In `src/index.ts`, after both detectors are started and before `serve()`:

```typescript
// Expiry cleanup — run every 60s
const expiryInterval = setInterval(() => {
  const count = db.expireStale();
  if (count > 0) console.log(`Expired ${count} stale pending transactions`);
}, 60_000);
```

Update shutdown handler to clear it:
```typescript
const shutdown = () => {
  clearInterval(expiryInterval);
  depositDetector.stop();
  buyDetector?.stop();
  db.close();
  process.exit(0);
};
```

**Step 2: Type-check and run all tests**

Run: `pnpm exec tsc --noEmit && pnpm test:run`
Expected: Clean, all tests pass

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire transaction expiry cleanup job (60s interval)"
```

---

### Task 3: Amount verification in deposit detectors

**Files:**
- Modify: `src/services/deposit.ts` (add getTransaction call)
- Modify: `src/services/buy-deposit.ts` (add getTransaction call)
- Modify: `src/services/deposit.test.ts` (new tests)
- Modify: `src/services/buy-deposit.test.ts` (new tests)

**Step 1: Write failing tests for sell deposit detector**

Add to `src/services/deposit.test.ts`:

```typescript
it('verifies deposit amount matches expected SOL and calls onDeposit', async () => {
  const onDeposit = vi.fn();
  const tx = db.create({
    type: 'sell', wallet: 'seller1', sol_amount: 5, usdc_amount: 4.75, memo: 'devsol-verify1',
  });

  const rpcWithAmount = {
    getSignaturesForAddress: vi.fn(() => ({
      send: vi.fn(async () => [
        { memo: '[15] devsol-verify1', signature: 'verified_sig' },
      ]),
    })),
    getTransaction: vi.fn(() => ({
      send: vi.fn(async () => ({
        meta: { preBalances: [10_000_000_000, 0], postBalances: [4_999_000_000, 5_000_000_000] },
      })),
    })),
  };

  const detector = new DepositDetector({
    db, rpc: rpcWithAmount as any, treasuryAddress: 'T', onDeposit,
  });
  await detector.poll();
  expect(onDeposit).toHaveBeenCalledWith(
    expect.objectContaining({ id: tx.id }),
    'verified_sig',
  );
});

it('rejects deposit when SOL amount is too low', async () => {
  const onDeposit = vi.fn();
  const tx = db.create({
    type: 'sell', wallet: 'seller1', sol_amount: 5, usdc_amount: 4.75, memo: 'devsol-low1',
  });

  const rpcLowAmount = {
    getSignaturesForAddress: vi.fn(() => ({
      send: vi.fn(async () => [
        { memo: '[15] devsol-low1', signature: 'low_sig' },
      ]),
    })),
    getTransaction: vi.fn(() => ({
      send: vi.fn(async () => ({
        meta: { preBalances: [1_000_000_000, 0], postBalances: [999_000_000, 1_000_000] },
      })),
    })),
  };

  const detector = new DepositDetector({
    db, rpc: rpcLowAmount as any, treasuryAddress: 'T', onDeposit,
  });
  await detector.poll();
  expect(onDeposit).not.toHaveBeenCalled();
  expect(db.getById(tx.id)!.status).toBe('failed');
});
```

**Step 2: Write failing tests for buy deposit detector**

Add to `src/services/buy-deposit.test.ts`:

```typescript
it('verifies USDC deposit amount matches expected and calls onDeposit', async () => {
  const onDeposit = vi.fn();
  const tx = db.create({
    type: 'buy', wallet: 'buyer1', sol_amount: 1, usdc_amount: 1.05, memo: 'devsol-buyverify1',
  });

  const rpcWithAmount = {
    getSignaturesForAddress: vi.fn(() => ({
      send: vi.fn(async () => [
        { memo: '[20] devsol-buyverify1', signature: 'buy_verified_sig' },
      ]),
    })),
    getTransaction: vi.fn(() => ({
      send: vi.fn(async () => ({
        meta: {
          preTokenBalances: [{ mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', uiTokenAmount: { uiAmount: 10 } }],
          postTokenBalances: [{ mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', uiTokenAmount: { uiAmount: 11.05 } }],
        },
      })),
    })),
  };

  const detector = new BuyDepositDetector({
    db, rpc: rpcWithAmount as any, usdcAtaAddress: 'ATA', onDeposit,
  });
  await detector.poll();
  expect(onDeposit).toHaveBeenCalledWith(
    expect.objectContaining({ id: tx.id }),
    'buy_verified_sig',
  );
});

it('rejects buy deposit when USDC amount is too low', async () => {
  const onDeposit = vi.fn();
  const tx = db.create({
    type: 'buy', wallet: 'buyer1', sol_amount: 1, usdc_amount: 1.05, memo: 'devsol-buylow1',
  });

  const rpcLowAmount = {
    getSignaturesForAddress: vi.fn(() => ({
      send: vi.fn(async () => [
        { memo: '[20] devsol-buylow1', signature: 'buy_low_sig' },
      ]),
    })),
    getTransaction: vi.fn(() => ({
      send: vi.fn(async () => ({
        meta: {
          preTokenBalances: [{ mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', uiTokenAmount: { uiAmount: 10 } }],
          postTokenBalances: [{ mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', uiTokenAmount: { uiAmount: 10.01 } }],
        },
      })),
    })),
  };

  const detector = new BuyDepositDetector({
    db, rpc: rpcLowAmount as any, usdcAtaAddress: 'ATA', onDeposit,
  });
  await detector.poll();
  expect(onDeposit).not.toHaveBeenCalled();
  expect(db.getById(tx.id)!.status).toBe('failed');
});
```

**Step 3: Run tests to verify they fail**

Run: `pnpm test:run -- src/services/deposit.test.ts src/services/buy-deposit.test.ts`
Expected: FAIL — `getTransaction` not called, amount not verified

**Step 4: Implement amount verification in DepositDetector**

In `src/services/deposit.ts`:

1. Extend `SolanaRpc` interface:
```typescript
interface SolanaRpc {
  getSignaturesForAddress(address: any, opts: any): {
    send(): Promise<Array<{ memo: string | null; signature: string }>>;
  };
  getTransaction(signature: any, opts: any): {
    send(): Promise<{
      meta: { preBalances: number[]; postBalances: number[] } | null;
    } | null>;
  };
}
```

2. Add `verifyAmount` method and update `poll()` to call it before `processDeposit`:

```typescript
async verifyDepositAmount(sig: string, expectedSol: number): Promise<boolean> {
  try {
    const txDetail = await this.cfg.rpc.getTransaction(sig, {
      maxSupportedTransactionVersion: 0,
    }).send();
    if (!txDetail?.meta) return false;

    // Treasury is the receiver — find balance increase in last account (receiver position)
    const { preBalances, postBalances } = txDetail.meta;
    const lastIdx = postBalances.length - 1;
    const received = (postBalances[lastIdx] - preBalances[lastIdx]) / 1_000_000_000;
    // Allow 0.1% tolerance for tx fees
    return received >= expectedSol * 0.999;
  } catch {
    return false;
  }
}
```

3. Update the `poll()` matching loop — after finding a memo match, verify amount before processing:

```typescript
if (matching) {
  const amountOk = await this.verifyDepositAmount(sig.signature, matching.sol_amount);
  if (amountOk) {
    await this.processDeposit(matching.id, sig.signature);
  } else {
    console.error(`Amount mismatch for sell ${matching.id} (sig: ${sig.signature})`);
    this.cfg.db.update(matching.id, { status: 'failed' });
  }
}
```

**Step 5: Implement amount verification in BuyDepositDetector**

In `src/services/buy-deposit.ts`:

1. Extend `SolanaRpc` interface:
```typescript
interface SolanaRpc {
  getSignaturesForAddress(address: any, opts: any): {
    send(): Promise<Array<{ memo: string | null; signature: string }>>;
  };
  getTransaction(signature: any, opts: any): {
    send(): Promise<{
      meta: {
        preTokenBalances: Array<{ mint: string; uiTokenAmount: { uiAmount: number } }>;
        postTokenBalances: Array<{ mint: string; uiTokenAmount: { uiAmount: number } }>;
      } | null;
    } | null>;
  };
}
```

2. Add USDC mint constant and `verifyUsdcAmount` method:

```typescript
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

async verifyUsdcAmount(sig: string, expectedUsdc: number): Promise<boolean> {
  try {
    const txDetail = await this.cfg.rpc.getTransaction(sig, {
      maxSupportedTransactionVersion: 0,
    }).send();
    if (!txDetail?.meta) return false;

    const { preTokenBalances, postTokenBalances } = txDetail.meta;
    const preBal = preTokenBalances.find(b => b.mint === USDC_MINT)?.uiTokenAmount.uiAmount ?? 0;
    const postBal = postTokenBalances.find(b => b.mint === USDC_MINT)?.uiTokenAmount.uiAmount ?? 0;
    const received = postBal - preBal;
    // Exact match for USDC (no fee tolerance needed)
    return received >= expectedUsdc;
  } catch {
    return false;
  }
}
```

3. Update `poll()` matching loop same pattern as sell detector.

**Step 6: Update existing tests that use simplified mocks**

Existing tests that mock `rpc` without `getTransaction` will need it added. For tests that don't care about amount verification, add a passing `getTransaction` mock:

```typescript
getTransaction: vi.fn(() => ({
  send: vi.fn(async () => ({
    meta: { preBalances: [10_000_000_000, 0], postBalances: [5_000_000_000, 5_000_000_000] },
  })),
})),
```

For buy detector tests:
```typescript
getTransaction: vi.fn(() => ({
  send: vi.fn(async () => ({
    meta: {
      preTokenBalances: [{ mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', uiTokenAmount: { uiAmount: 0 } }],
      postTokenBalances: [{ mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', uiTokenAmount: { uiAmount: 100 } }],
    },
  })),
})),
```

**Step 7: Run all tests**

Run: `pnpm test:run`
Expected: ALL PASS

**Step 8: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: Clean

**Step 9: Commit**

```bash
git add src/services/deposit.ts src/services/deposit.test.ts src/services/buy-deposit.ts src/services/buy-deposit.test.ts
git commit -m "feat: verify deposit amounts on-chain before processing"
```

---

### Task 4: Install pino and create logger module

**Files:**
- Create: `src/logger.ts`
- Create: `src/logger.test.ts`

**Step 1: Install pino**

Run: `pnpm add pino`

**Step 2: Write the test**

```typescript
import { describe, it, expect } from 'vitest';
import { createLogger } from './logger.js';

describe('Logger', () => {
  it('creates a logger with correct name', () => {
    const log = createLogger('test');
    expect(log).toBeDefined();
    // Pino loggers have a .child method
    expect(typeof log.child).toBe('function');
    expect(typeof log.info).toBe('function');
    expect(typeof log.error).toBe('function');
  });
});
```

**Step 3: Implement logger**

```typescript
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino/file', options: { destination: 1 } }
    : undefined,
});

export function createLogger(name: string) {
  return logger.child({ module: name });
}
```

**Step 4: Run test**

Run: `pnpm test:run -- src/logger.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/logger.ts src/logger.test.ts package.json pnpm-lock.yaml
git commit -m "feat: add pino structured logger"
```

---

### Task 5: Replace console.* with structured logging

**Files:**
- Modify: `src/index.ts`
- Modify: `src/app.ts`
- Modify: `src/deposit-handler.ts`
- Modify: `src/buy-deposit-handler.ts`
- Modify: `src/services/deposit.ts`
- Modify: `src/services/buy-deposit.ts`
- Modify: `src/services/payout.ts`

**Step 1: Replace all console.* calls across files**

Pattern: `import { createLogger } from './logger.js'` at top, `const log = createLogger('module-name')`, then:

| Old | New |
|-----|-----|
| `console.log(msg)` | `log.info(msg)` |
| `console.warn(msg)` | `log.warn(msg)` |
| `console.error(msg, err)` | `log.error({ err }, msg)` |

Key replacements:
- `src/index.ts`: `createLogger('server')` — startup messages, shutdown
- `src/app.ts`: `createLogger('rate-limit')` — rate limit warnings
- `src/deposit-handler.ts`: `createLogger('sell-handler')` — deposit confirmed, payout, refund, CRITICAL
- `src/buy-deposit-handler.ts`: `createLogger('buy-handler')` — USDC confirmed, SOL delivery, refund, CRITICAL
- `src/services/deposit.ts`: `createLogger('sell-detector')` — started, poll error
- `src/services/buy-deposit.ts`: `createLogger('buy-detector')` — started, poll error
- `src/services/payout.ts`: `createLogger('payout')` — retry warnings

**Step 2: Run all tests**

Run: `pnpm test:run`
Expected: ALL PASS (pino writes to stdout, doesn't affect test assertions)

**Step 3: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: Clean

**Step 4: Commit**

```bash
git add src/index.ts src/app.ts src/deposit-handler.ts src/buy-deposit-handler.ts src/services/deposit.ts src/services/buy-deposit.ts src/services/payout.ts
git commit -m "refactor: replace console.* with pino structured logging"
```

---

### Task 6: Add low balance alerts and extend /health/detail

**Files:**
- Modify: `src/routes/treasury.ts`
- Modify: `src/routes/treasury.test.ts`
- Modify: `src/index.ts` (balance check in expiry interval)

**Step 1: Write failing tests**

Add to `src/routes/treasury.test.ts`:

```typescript
it('GET /health/detail includes pending_orders count', async () => {
  const mockDb = { findPendingSells: vi.fn(() => [1, 2]), findPendingBuys: vi.fn(() => [3]) };
  const detailApp = new Hono();
  detailApp.route('/', treasuryRoutes(mockTreasury as any, mockPayout as any, mockDb as any));

  const res = await detailApp.request('/health/detail');
  const body = await res.json();
  expect(body.pending_orders).toBe(3);
});
```

**Step 2: Implement**

Update `treasuryRoutes` to accept optional `db` parameter:

```typescript
export function treasuryRoutes(
  treasury: TreasuryService,
  payout?: { getUsdcBalance(): Promise<number>; walletAddress: string },
  db?: { findPendingSells(): unknown[]; findPendingBuys(): unknown[] },
)
```

Extend `/health/detail` response:

```typescript
pending_orders: db ? db.findPendingSells().length + db.findPendingBuys().length : null,
```

Add low balance check in `src/index.ts` inside the expiry interval callback:

```typescript
const expiryInterval = setInterval(async () => {
  const count = db.expireStale();
  if (count > 0) log.info(`Expired ${count} stale pending transactions`);

  // Low balance alerts
  try {
    const treasuryBal = await treasury.getBalance();
    if (treasuryBal < 10) log.error({ balance: treasuryBal }, 'LOW BALANCE: Treasury SOL below 10');
    if (payout) {
      const payoutBal = await payout.getUsdcBalance();
      if (payoutBal < 10) log.error({ balance: payoutBal }, 'LOW BALANCE: Payout USDC below 10');
    }
  } catch (err) {
    log.error({ err }, 'Balance check failed');
  }
}, 60_000);
```

**Step 3: Update app.ts to pass db to treasuryRoutes**

```typescript
app.route('/', treasuryRoutes(deps.treasury, deps.payout, db));
```

**Step 4: Run all tests**

Run: `pnpm test:run`
Expected: ALL PASS

**Step 5: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: Clean

**Step 6: Commit**

```bash
git add src/routes/treasury.ts src/routes/treasury.test.ts src/index.ts src/app.ts
git commit -m "feat: add low balance alerts and pending_orders to /health/detail"
```

---

### Task 7: Update CLAUDE.md and ROADMAP.md

**Files:**
- Modify: `CLAUDE.md`
- Modify: `ROADMAP.md`

**Step 1: Update CLAUDE.md**

- Add `pino` to stack
- Update test counts
- Add `expires_at` to key details
- Add amount verification to key details
- Note structured logging

**Step 2: Update ROADMAP.md**

- Mark Phase 0 items as `[x]`
- Mark all Phase 1 items as `[x]`

**Step 3: Commit**

```bash
git add CLAUDE.md ROADMAP.md
git commit -m "docs: update CLAUDE.md and ROADMAP.md for Phase 1 completion"
```

---

### Task 8: Final verification

**Step 1: Run full test suite**

Run: `pnpm test:run`
Expected: All tests pass (should be ~115-120 tests across 16-17 files)

**Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: Clean

**Step 3: Review all changes**

Run: `git log --oneline dev...` to verify commit history is clean and focused.
