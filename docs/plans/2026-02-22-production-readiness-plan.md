# DevSOL Production Readiness Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make DevSOL a real marketplace with real x402 payment verification, real USDC payouts, and hardened API.

**Architecture:** Replace stub x402 facilitator with `HTTPFacilitatorClient` from `@x402/core`. Add `PayoutService` for mainnet USDC SPL token transfers using `@solana-program/token`. Add balance pre-checks to both buy and sell flows — no SOL = no buy, no USDC = no sell. Auto-refund devnet SOL if payout fails.

**Tech Stack:** `@x402/core` (facilitator client + header encoding), `@x402/svm` (SVM network constants), `@solana-program/token` (SPL token transfer), `@solana/kit` (RPC + transaction building), Hono, better-sqlite3, vitest.

**Design Doc:** `docs/plans/2026-02-22-production-readiness-design.md`

---

## Task 1: Config Hardening

**Files:**
- Modify: `src/config.ts`
- Test: `src/config.test.ts` (NEW — currently no config tests)

**Step 1: Write failing test for missing treasury keypair**

```typescript
// src/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('config', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('throws when DEVSOL_TREASURY_KEYPAIR is not set', async () => {
    delete process.env.DEVSOL_TREASURY_KEYPAIR;
    // Clear module cache for re-import
    await expect(
      import('./config.js').then(m => m.config)
    ).rejects.toThrow('Missing env var: DEVSOL_TREASURY_KEYPAIR');
  });
});
```

NOTE: Config module validation is tricky with vitest module caching. The implementer should use `vi.resetModules()` before each dynamic import to avoid cached values. If module-level config validation proves too difficult to test reliably with vitest's module cache, skip the unit test and verify manually — the behavior (crash on startup with clear error) is what matters.

**Step 2: Update config.ts**

```typescript
// src/config.ts
function env(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (value === undefined) throw new Error(`Missing env var: ${key}`);
  return value;
}

export const config = {
  port: Number(env('DEVSOL_PORT', '3100')),
  treasuryKeypair: env('DEVSOL_TREASURY_KEYPAIR'),  // NO fallback — crash if missing
  mainnetKeypair: env('DEVSOL_MAINNET_KEYPAIR', ''), // empty = sell disabled
  facilitatorUrl: env('DEVSOL_X402_FACILITATOR_URL', 'https://x402.org/facilitator'),
  devnetRpc: env('DEVSOL_DEVNET_RPC', 'https://api.devnet.solana.com'),
  devnetWss: env('DEVSOL_DEVNET_WSS', 'wss://api.devnet.solana.com'),
  mainnetRpc: env('DEVSOL_MAINNET_RPC', 'https://api.mainnet-beta.solana.com'),
  mainnetWss: env('DEVSOL_MAINNET_WSS', 'wss://api.mainnet-beta.solana.com'),
  buyPrice: Number(env('DEVSOL_BUY_PRICE', '1.05')),
  sellPrice: Number(env('DEVSOL_SELL_PRICE', '0.95')),
  corsOrigin: env('DEVSOL_CORS_ORIGIN', 'https://devsol.rectorspace.com'),
  dbPath: env('DEVSOL_DB_PATH', './devsol.db'),
  svmNetwork: env('DEVSOL_SVM_NETWORK', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'),
  maxPayoutUsdc: Number(env('DEVSOL_MAX_PAYOUT_USDC', '100')),
  minReserveUsdc: Number(env('DEVSOL_MIN_RESERVE_USDC', '50')),
} as const;
```

Key changes:
- `treasuryKeypair`: removed empty string fallback — crashes if not set
- `mainnetKeypair`: added with empty string fallback (sell flow disabled if empty)
- `maxPayoutUsdc`: safety limit per tx
- `minReserveUsdc`: minimum USDC to keep in hot wallet

**Step 3: Update .env.example**

Add the new env vars to `.env.example` so the shape is documented.

**Step 4: Run tests**

Run: `pnpm test:run`
Expected: All existing tests still pass (they don't import config directly in most cases). The config module itself is loaded at app startup, not in test modules.

**Step 5: Commit**

```bash
git add src/config.ts .env.example
git commit -m "feat: harden config — remove empty defaults, add payout config"
```

---

## Task 2: DB Migration — Add mainnet_payout_tx Column

**Files:**
- Modify: `src/db/sqlite.ts`
- Modify: `src/db/sqlite.test.ts`

**Step 1: Write failing test**

```typescript
// Add to src/db/sqlite.test.ts
it('stores mainnet_payout_tx on update', () => {
  const tx = db.create({ type: 'sell', wallet: 'abc', sol_amount: 5, usdc_amount: 4.75, memo: 'devsol-abc' });
  db.update(tx.id, { mainnet_payout_tx: 'mainnet_sig_abc123' });
  const updated = db.getById(tx.id);
  expect(updated!.mainnet_payout_tx).toBe('mainnet_sig_abc123');
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test:run src/db/sqlite.test.ts`
Expected: FAIL — `mainnet_payout_tx` property doesn't exist

**Step 3: Update sqlite.ts**

Add column to schema:
```sql
mainnet_payout_tx TEXT,
```

Add to `Transaction` interface:
```typescript
mainnet_payout_tx: string | null;
```

Add to `UpdateTransactionInput`:
```typescript
mainnet_payout_tx?: string;
```

Add to `update()` method:
```typescript
if (input.mainnet_payout_tx !== undefined) {
  sets.push('mainnet_payout_tx = ?');
  values.push(input.mainnet_payout_tx);
}
```

Add migration for existing databases:
```typescript
private migrate() {
  // ... existing CREATE TABLE ...

  // Add mainnet_payout_tx column if it doesn't exist
  const columns = this.db.pragma('table_info(transactions)') as Array<{ name: string }>;
  if (!columns.some(c => c.name === 'mainnet_payout_tx')) {
    this.db.exec('ALTER TABLE transactions ADD COLUMN mainnet_payout_tx TEXT');
  }
}
```

**Step 4: Run tests**

Run: `pnpm test:run src/db/sqlite.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/db/sqlite.ts src/db/sqlite.test.ts
git commit -m "feat: add mainnet_payout_tx column to transactions"
```

---

## Task 3: X402Service Rewrite — Real Facilitator

**Files:**
- Modify: `src/services/x402.ts`
- Modify: `src/services/x402.test.ts`

**Step 1: Write failing tests for new X402Service**

```typescript
// src/services/x402.test.ts — full rewrite
import { describe, it, expect, vi } from 'vitest';
import { X402Service } from './x402.js';

describe('X402Service', () => {
  const mockFacilitator = {
    verify: vi.fn(),
    settle: vi.fn(),
    getSupported: vi.fn(),
  };

  const service = new X402Service({
    facilitator: mockFacilitator as any,
    payTo: 'TreasuryMainnetAddress',
    network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  });

  it('creates payment requirements for a given USDC amount', () => {
    const req = service.createPaymentRequirements(10.5);
    expect(req.scheme).toBe('exact');
    expect(req.network).toBe('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp');
    expect(req.payTo).toBe('TreasuryMainnetAddress');
    expect(req.amount).toBe('10500000'); // 10.5 USDC in atomic units (6 decimals)
  });

  it('creates 402 payment required response', () => {
    const payload = service.createPaymentRequired(10.5, 'Buy 10 SOL devnet');
    expect(payload.x402Version).toBe(2);
    expect(payload.accepts).toHaveLength(1);
    expect(payload.accepts[0].scheme).toBe('exact');
    expect(payload.accepts[0].payTo).toBe('TreasuryMainnetAddress');
  });

  it('encodes payment required as base64 header', () => {
    const payload = service.createPaymentRequired(10.5, 'Buy 10 SOL devnet');
    const encoded = service.encodePaymentRequiredHeader(payload);
    expect(typeof encoded).toBe('string');
    // Should be valid base64
    expect(() => Buffer.from(encoded, 'base64')).not.toThrow();
  });

  it('verifies a payment via facilitator', async () => {
    mockFacilitator.verify.mockResolvedValue({ isValid: true, payer: 'payer123' });
    const result = await service.verifyPayment('base64-payment-header', 10.5);
    expect(result.isValid).toBe(true);
    expect(mockFacilitator.verify).toHaveBeenCalled();
  });

  it('settles a payment via facilitator', async () => {
    mockFacilitator.settle.mockResolvedValue({ success: true, transaction: 'tx123', network: 'solana:test' });
    const result = await service.settlePayment('base64-payment-header', 10.5);
    expect(result.success).toBe(true);
    expect(mockFacilitator.settle).toHaveBeenCalled();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm test:run src/services/x402.test.ts`
Expected: FAIL — methods don't exist yet

**Step 3: Rewrite x402.ts**

The service needs to:
1. Accept a facilitator client (HTTPFacilitatorClient or mock with same interface)
2. Create `PaymentRequirements` with proper USDC atomic amounts
3. Create `PaymentRequired` response (x402 v2 format)
4. Encode/decode base64 headers per x402 spec
5. Verify payments via facilitator
6. Settle payments via facilitator

Import `@x402/svm` constants for USDC addresses:
```typescript
import { USDC_MAINNET_ADDRESS, convertToTokenAmount } from '@x402/svm';
```

Or define locally if import issues arise:
```typescript
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_DECIMALS = 6;
```

Key methods:
- `createPaymentRequirements(usdcAmount)` — returns `PaymentRequirements` object
- `createPaymentRequired(usdcAmount, description)` — returns full 402 payload
- `encodePaymentRequiredHeader(payload)` — base64 encode for response header
- `decodePaymentSignatureHeader(header)` — base64 decode incoming payment
- `verifyPayment(paymentHeader, usdcAmount)` — decode + call facilitator.verify
- `settlePayment(paymentHeader, usdcAmount)` — decode + call facilitator.settle

NOTE: Check if `@x402/core/http` exports work with ESM (`"type": "module"` in our package.json). If the import path doesn't resolve, use the types manually and call the facilitator HTTP endpoint directly. The @x402/core package exports via subpath exports in its package.json — check `node_modules/@x402/core/package.json` for the actual export map.

**Step 4: Run tests**

Run: `pnpm test:run src/services/x402.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/services/x402.ts src/services/x402.test.ts
git commit -m "feat: rewrite X402Service with real facilitator integration"
```

---

## Task 4: Buy Route — x402 Spec Headers + Balance Pre-check

**Files:**
- Modify: `src/routes/buy.ts`
- Modify: `src/routes/buy.test.ts`

**Step 1: Write new/updated tests**

```typescript
// Add to buy.test.ts:

it('returns 503 when treasury has insufficient SOL', async () => {
  mockTreasury.getBalance.mockResolvedValueOnce(0);
  const res = await app.request('/buy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wallet: 'BuyerWa11etAddressXXXXXXXXXXXXXXXXXXXXXXXX', amount_sol: 10 }),
  });
  expect(res.status).toBe(503);
  const body = await res.json();
  expect(body.code).toBe('INSUFFICIENT_RESERVES');
});

it('returns 402 with PAYMENT-REQUIRED header (not X-PAYMENT)', async () => {
  mockTreasury.getBalance.mockResolvedValueOnce(100);
  const res = await app.request('/buy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wallet: 'BuyerWa11etAddressXXXXXXXXXXXXXXXXXXXXXXXX', amount_sol: 10 }),
  });
  expect(res.status).toBe(402);
  // Check for PAYMENT-REQUIRED header (base64 encoded)
  const prHeader = res.headers.get('payment-required');
  expect(prHeader).toBeTruthy();
});
```

Update existing test for `PAYMENT-SIGNATURE` header (was `X-PAYMENT`):
```typescript
it('processes buy with valid PAYMENT-SIGNATURE header', async () => {
  mockTreasury.getBalance.mockResolvedValueOnce(100);
  const res = await app.request('/buy', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'PAYMENT-SIGNATURE': 'valid-payment-proof', // was X-PAYMENT
    },
    body: JSON.stringify({ wallet: 'BuyerWa11etAddressXXXXXXXXXXXXXXXXXXXXXXXX', amount_sol: 10 }),
  });
  expect(res.status).toBe(200);
});
```

**Step 2: Run tests to verify new ones fail**

Run: `pnpm test:run src/routes/buy.test.ts`
Expected: New tests FAIL

**Step 3: Update buy.ts**

Changes:
1. Add `getBalance()` pre-check before processing
2. Change `c.req.header('X-PAYMENT')` → `c.req.header('payment-signature')`
3. Use `x402.encodePaymentRequiredHeader()` to set `PAYMENT-REQUIRED` header on 402 response
4. Call `x402.settlePayment()` async after SOL delivery (fire and forget with .catch)
5. Consistent error format: `{ error, code }`

The buy route now needs treasury in its deps for `getBalance()` (it already has it).

**Step 4: Run tests**

Run: `pnpm test:run src/routes/buy.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/routes/buy.ts src/routes/buy.test.ts
git commit -m "feat: buy route x402 spec headers + balance pre-check"
```

---

## Task 5: PayoutService — Mainnet USDC Transfers

**Files:**
- Create: `src/services/payout.ts`
- Create: `src/services/payout.test.ts`

**Step 1: Write failing tests**

```typescript
// src/services/payout.test.ts
import { describe, it, expect, vi } from 'vitest';
import { PayoutService } from './payout.js';

describe('PayoutService', () => {
  // Mock the RPC and sendAndConfirm at the service level
  const mockGetBalance = vi.fn();
  const mockSendUsdc = vi.fn();

  // Test canAffordPayout logic
  describe('canAffordPayout', () => {
    it('returns true when balance covers payout + reserve', async () => {
      // balance=200, payout=100, reserve=50 → 200 >= 100+50 → true
      const service = createMockService({ balance: 200, maxPayout: 100, minReserve: 50 });
      expect(await service.canAffordPayout(100)).toBe(true);
    });

    it('returns false when balance below payout + reserve', async () => {
      // balance=100, payout=80, reserve=50 → 100 < 80+50 → false
      const service = createMockService({ balance: 100, maxPayout: 100, minReserve: 50 });
      expect(await service.canAffordPayout(80)).toBe(false);
    });

    it('returns false when payout exceeds max', async () => {
      const service = createMockService({ balance: 1000, maxPayout: 100, minReserve: 50 });
      expect(await service.canAffordPayout(150)).toBe(false);
    });
  });
});

// Helper to create a PayoutService with mocked internals
function createMockService(opts: { balance: number; maxPayout: number; minReserve: number }) {
  // Implementation depends on PayoutService constructor — adapt after writing the service.
  // The service should accept a getUsdcBalance function for testability.
}
```

NOTE: The actual `sendUsdc` method calls on-chain functions. For unit tests, mock the RPC layer. The implementer should design `PayoutService` to accept dependencies (RPC, sendAndConfirm) via constructor for testability — same pattern as `TreasuryService.create()`.

**Step 2: Write PayoutService**

```typescript
// src/services/payout.ts
import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  sendAndConfirmTransactionFactory,
  createKeyPairSignerFromBytes,
  address,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  getSignatureFromTransaction,
  type KeyPairSigner,
  type Rpc,
  type SolanaRpcApi,
} from '@solana/kit';

import {
  findAssociatedTokenPda,
  getTransferCheckedInstruction,
  getCreateAssociatedTokenIdempotentInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';

const USDC_MINT = address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const USDC_DECIMALS = 6;

interface PayoutConfig {
  rpcUrl: string;
  wssUrl: string;
  keypairBytes: Uint8Array;
  maxPayoutUsdc: number;
  minReserveUsdc: number;
}

export class PayoutService {
  private constructor(
    private signer: KeyPairSigner,
    private rpc: Rpc<SolanaRpcApi>,
    private sendAndConfirm: ReturnType<typeof sendAndConfirmTransactionFactory>,
    private maxPayout: number,
    private minReserve: number,
  ) {}

  static async create(cfg: PayoutConfig): Promise<PayoutService> {
    const rpc = createSolanaRpc(cfg.rpcUrl);
    const rpcSub = createSolanaRpcSubscriptions(cfg.wssUrl);
    const signer = await createKeyPairSignerFromBytes(cfg.keypairBytes);
    const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions: rpcSub });
    return new PayoutService(signer, rpc, sendAndConfirm, cfg.maxPayoutUsdc, cfg.minReserveUsdc);
  }

  get walletAddress(): string { return this.signer.address; }

  async getUsdcBalance(): Promise<number> {
    const [ata] = await findAssociatedTokenPda({
      mint: USDC_MINT,
      owner: this.signer.address,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    try {
      const { value } = await this.rpc.getTokenAccountBalance(ata).send();
      return Number(value.uiAmount ?? 0);
    } catch {
      return 0; // ATA doesn't exist = 0 balance
    }
  }

  async canAffordPayout(usdcAmount: number): Promise<boolean> {
    if (usdcAmount > this.maxPayout) return false;
    const balance = await this.getUsdcBalance();
    return balance >= usdcAmount + this.minReserve;
  }

  async sendUsdc(recipient: string, usdcAmount: number): Promise<string> {
    if (usdcAmount <= 0) throw new Error('Amount must be positive');
    if (usdcAmount > this.maxPayout) throw new Error(`Payout exceeds max: ${this.maxPayout} USDC`);

    const recipientAddr = address(recipient);
    const rawAmount = BigInt(Math.round(usdcAmount * 10 ** USDC_DECIMALS));

    const [senderAta] = await findAssociatedTokenPda({
      mint: USDC_MINT,
      owner: this.signer.address,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    const [recipientAta] = await findAssociatedTokenPda({
      mint: USDC_MINT,
      owner: recipientAddr,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    const createAtaIx = getCreateAssociatedTokenIdempotentInstruction({
      payer: this.signer,
      ata: recipientAta,
      owner: recipientAddr,
      mint: USDC_MINT,
    });

    const transferIx = getTransferCheckedInstruction({
      source: senderAta,
      mint: USDC_MINT,
      destination: recipientAta,
      authority: this.signer,
      amount: rawAmount,
      decimals: USDC_DECIMALS,
    });

    const { value: latestBlockhash } = await this.rpc.getLatestBlockhash().send();
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(this.signer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
      (m) => appendTransactionMessageInstructions([createAtaIx, transferIx], m),
    );

    const signedTx = await signTransactionMessageWithSigners(message);
    const signature = getSignatureFromTransaction(signedTx);
    await this.sendAndConfirm(
      signedTx as Parameters<typeof this.sendAndConfirm>[0],
      { commitment: 'confirmed' },
    );
    return signature;
  }
}
```

**Step 3: Run tests**

Run: `pnpm test:run src/services/payout.test.ts`
Expected: ALL PASS (with properly mocked dependencies)

**Step 4: Commit**

```bash
git add src/services/payout.ts src/services/payout.test.ts
git commit -m "feat: add PayoutService for mainnet USDC transfers"
```

---

## Task 6: Sell Route — USDC Pre-check

**Files:**
- Modify: `src/routes/sell.ts`
- Modify: `src/routes/sell.test.ts`

**Step 1: Write failing tests**

```typescript
// Add to sell.test.ts — need to add payout mock to deps

const mockPayout = {
  canAffordPayout: vi.fn(async () => true),
};

// Update sellRoutes call to include payout:
// sellRoutes({ db, pricing, treasuryAddress, payout: mockPayout as any })

it('returns 503 when USDC reserves insufficient', async () => {
  mockPayout.canAffordPayout.mockResolvedValueOnce(false);
  const res = await app.request('/sell', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wallet: 'Se11erWa11etAddressXXXXXXXXXXXXXXXXXXXXXXXX', amount_sol: 10 }),
  });
  expect(res.status).toBe(503);
  const body = await res.json();
  expect(body.code).toBe('INSUFFICIENT_RESERVES');
});
```

**Step 2: Run tests to verify fail**

**Step 3: Update sell.ts**

Add `payout` to `SellDeps`:
```typescript
interface SellDeps {
  db: TransactionDB;
  pricing: PricingService;
  treasuryAddress: string;
  payout?: { canAffordPayout(usdcAmount: number): Promise<boolean> };
}
```

At the top of the POST handler, after validation and quote calculation:
```typescript
if (deps.payout) {
  const canPay = await deps.payout.canAffordPayout(quote.usdc_amount);
  if (!canPay) {
    return c.json({ error: 'Sell temporarily unavailable: insufficient reserves', code: 'INSUFFICIENT_RESERVES' }, 503);
  }
}
```

Make payout optional so existing tests (without payout mock) still pass (sell without payout check = testing mode).

**Step 4: Run tests**

Run: `pnpm test:run src/routes/sell.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/routes/sell.ts src/routes/sell.test.ts
git commit -m "feat: sell route USDC reserve pre-check"
```

---

## Task 7: Deposit Detector — Payout + Refund

**Files:**
- Modify: `src/services/deposit.ts`
- Modify: `src/services/deposit.test.ts`

**Step 1: Write failing tests**

The `onDeposit` callback in `index.ts` currently just logs. We need to update the deposit detector's config to accept a payout service and treasury for refunds. Actually, the callback pattern is already flexible — we just need to update the callback in `index.ts` (Task 9). But let's add a test that verifies the callback receives the right data for payout.

```typescript
// Add to deposit.test.ts:

it('provides wallet and usdc_amount in onDeposit for payout', async () => {
  const onDeposit = vi.fn();
  const tx = db.create({
    type: 'sell',
    wallet: 'Se11erWa11etXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    sol_amount: 5,
    usdc_amount: 4.75,
    memo: 'devsol-payout1',
  });

  const detector = new DepositDetector({
    db, rpc: mockRpc as any, treasuryAddress: 'T', onDeposit,
  });

  await detector.processDeposit(tx.id, 'devnet_sig');
  expect(onDeposit).toHaveBeenCalledWith(
    expect.objectContaining({
      wallet: 'Se11erWa11etXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      usdc_amount: 4.75,
      status: 'completed',
    }),
    'devnet_sig',
  );
});
```

No changes to `deposit.ts` itself — the existing code already passes the full transaction to `onDeposit`. The payout logic lives in the callback wired in `index.ts` (Task 9).

**Step 2: Run tests**

Run: `pnpm test:run src/services/deposit.test.ts`
Expected: PASS (test just verifies existing behavior)

**Step 3: Commit**

```bash
git add src/services/deposit.test.ts
git commit -m "test: verify deposit callback provides payout data"
```

---

## Task 8: Health Detail Endpoint

**Files:**
- Modify: `src/routes/treasury.ts`
- Modify: `src/routes/treasury.test.ts`

**Step 1: Write failing test**

```typescript
// Add to treasury.test.ts:

it('GET /health/detail returns service status', async () => {
  const mockPayout = {
    getUsdcBalance: vi.fn(async () => 500),
    walletAddress: 'PayoutWallet111',
  };
  const detailApp = new Hono();
  detailApp.route('/', treasuryRoutes(mockTreasury as any, mockPayout as any));

  const res = await detailApp.request('/health/detail');
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.treasury_sol).toBe(6842.5);
  expect(body.payout_usdc).toBe(500);
});
```

**Step 2: Update treasury.ts**

```typescript
export function treasuryRoutes(treasury: TreasuryService, payout?: { getUsdcBalance(): Promise<number>; walletAddress: string }) {
  const router = new Hono();

  router.get('/treasury', async (c) => {
    // ... existing code ...
  });

  router.get('/health/detail', async (c) => {
    try {
      const treasurySol = await treasury.getBalance();
      const payoutUsdc = payout ? await payout.getUsdcBalance() : null;
      return c.json({
        treasury_sol: treasurySol,
        payout_usdc: payoutUsdc,
        payout_wallet: payout?.walletAddress ?? null,
      });
    } catch {
      return c.json({ error: 'Health check failed' }, 503);
    }
  });

  return router;
}
```

**Step 3: Run tests**

Run: `pnpm test:run src/routes/treasury.test.ts`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add src/routes/treasury.ts src/routes/treasury.test.ts
git commit -m "feat: add /health/detail endpoint with treasury + payout status"
```

---

## Task 9: Wire Everything in index.ts

**Files:**
- Modify: `src/index.ts`
- Modify: `src/app.ts` (add payout to AppDeps)

**Step 1: Update app.ts to accept payout dep**

Add `payout` to `AppDeps`:
```typescript
interface AppDeps {
  pricing?: PricingService;
  treasury?: TreasuryService;
  db?: TransactionDB;
  x402?: X402Service;
  payout?: PayoutService;
}
```

Pass payout to sell routes:
```typescript
app.route('/', sellRoutes({ db, pricing, treasuryAddress: deps.treasury.address, payout: deps.payout }));
```

Pass payout to treasury routes:
```typescript
app.route('/', treasuryRoutes(deps.treasury, deps.payout));
```

**Step 2: Rewrite index.ts**

```typescript
import { serve } from '@hono/node-server';
import { readFileSync } from 'fs';
import { createSolanaRpc } from '@solana/kit';
import { HTTPFacilitatorClient } from '@x402/core/http';
import { createApp } from './app.js';
import { TreasuryService } from './services/treasury.js';
import { X402Service } from './services/x402.js';
import { PayoutService } from './services/payout.js';
import { DepositDetector } from './services/deposit.js';
import { config } from './config.js';

async function main() {
  // Devnet treasury (SOL)
  const keypairJson = readFileSync(config.treasuryKeypair, 'utf-8');
  const keypairBytes = new Uint8Array(JSON.parse(keypairJson));
  const treasury = await TreasuryService.create({
    rpcUrl: config.devnetRpc,
    wssUrl: config.devnetWss,
    keypairBytes,
  });

  // x402 facilitator (real)
  const facilitator = new HTTPFacilitatorClient({ url: config.facilitatorUrl });
  const x402 = new X402Service({
    facilitator,
    payTo: treasury.address,
    network: config.svmNetwork,
  });

  // Mainnet payout (USDC) — optional, enables sell flow
  let payout: PayoutService | undefined;
  if (config.mainnetKeypair) {
    const mainnetJson = readFileSync(config.mainnetKeypair, 'utf-8');
    const mainnetBytes = new Uint8Array(JSON.parse(mainnetJson));
    payout = await PayoutService.create({
      rpcUrl: config.mainnetRpc,
      wssUrl: config.mainnetWss,
      keypairBytes: mainnetBytes,
      maxPayoutUsdc: config.maxPayoutUsdc,
      minReserveUsdc: config.minReserveUsdc,
    });
    console.log(`Payout wallet: ${payout.walletAddress}`);
  } else {
    console.warn('WARNING: No mainnet keypair configured — sell payouts disabled');
  }

  const { app, db } = createApp({ treasury, x402, payout });

  // Deposit detector with payout callback
  const devnetRpc = createSolanaRpc(config.devnetRpc);
  const depositDetector = new DepositDetector({
    db,
    rpc: devnetRpc as any,
    treasuryAddress: treasury.address,
    onDeposit: async (tx, devnetSig) => {
      console.log(`Deposit confirmed for sell ${tx.id}: ${devnetSig}`);
      if (!payout) {
        console.warn(`No payout service — sell ${tx.id} completed without USDC payout`);
        return;
      }
      try {
        const mainnetSig = await payout.sendUsdc(tx.wallet, tx.usdc_amount);
        db.update(tx.id, { mainnet_payout_tx: mainnetSig });
        console.log(`USDC payout sent for sell ${tx.id}: ${mainnetSig}`);
      } catch (err) {
        console.error(`USDC payout failed for sell ${tx.id}:`, err);
        // Refund devnet SOL
        try {
          const refundSig = await treasury.sendSol(tx.wallet, tx.sol_amount);
          db.update(tx.id, { status: 'refunded', devnet_tx: refundSig });
          console.log(`Refunded ${tx.sol_amount} SOL to ${tx.wallet}: ${refundSig}`);
        } catch (refundErr) {
          console.error(`CRITICAL: Refund also failed for sell ${tx.id}:`, refundErr);
          db.update(tx.id, { status: 'failed' });
        }
      }
    },
  });
  depositDetector.start();

  // Graceful shutdown
  const shutdown = () => {
    depositDetector.stop();
    db.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`DevSOL running on http://localhost:${info.port}`);
    console.log(`Treasury: ${treasury.address}`);
  });
}

main().catch(console.error);
```

NOTE on `@x402/core/http` import: If this subpath import fails due to ESM/CJS mismatch, the implementer should try:
1. `import { HTTPFacilitatorClient } from '@x402/core/http'` (preferred)
2. `import { HTTPFacilitatorClient } from '@x402/core'` (if re-exported from root)
3. Roll a minimal HTTP wrapper that calls `POST {facilitatorUrl}/verify` and `POST {facilitatorUrl}/settle` directly — it's just two HTTP calls

**Step 3: Update app.test.ts**

Update `makeDeps()` and related tests to account for new optional payout dep and any interface changes to X402Service.

**Step 4: Run full test suite**

Run: `pnpm test:run`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/index.ts src/app.ts src/app.test.ts
git commit -m "feat: wire real facilitator + payout service + deposit refund"
```

---

## Task 10: Update VPS .env and Deploy

**Files:**
- No code changes — VPS config + deploy

**Step 1: Update VPS .env with mainnet keypair path**

```bash
ssh devsol  # add DEVSOL_MAINNET_KEYPAIR to .env if keypair exists
```

For now, mainnet keypair can be empty (sell payouts disabled until funded). The system gracefully handles this with a warning.

**Step 2: Merge to main and push**

```bash
git checkout main && git merge dev --no-edit && git push origin main
```

**Step 3: Monitor deploy**

```bash
gh run watch --repo RECTOR-LABS/devsol
```

**Step 4: Verify health**

```bash
curl https://devsol.rectorspace.com/health
curl https://devsol.rectorspace.com/health/detail
```

---

## Summary of Tasks

| Task | Description | Files |
|------|-------------|-------|
| 1 | Config hardening | config.ts |
| 2 | DB migration — mainnet_payout_tx | sqlite.ts |
| 3 | X402Service rewrite | x402.ts |
| 4 | Buy route — x402 headers + pre-check | buy.ts |
| 5 | PayoutService — mainnet USDC | payout.ts (NEW) |
| 6 | Sell route — USDC pre-check | sell.ts |
| 7 | Deposit detector — payout test | deposit.test.ts |
| 8 | Health detail endpoint | treasury.ts |
| 9 | Wire everything | index.ts, app.ts |
| 10 | VPS deploy | ops only |
