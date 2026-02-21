# DevSOL — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a two-sided Solana devnet SOL marketplace API with x402 payments — instant buy/sell of devnet SOL for USDC.

**Architecture:** Hono API server on Node.js. x402 protocol for USDC payments on Solana mainnet (manual handler for dynamic pricing, not declarative middleware). Treasury service via @solana/kit for devnet SOL transfers. SQLite transaction log. Docker deployment on reclabs VPS behind nginx.

**Tech Stack:** Hono, @hono/node-server, @x402/hono, @x402/svm, @x402/core, @solana/kit, @solana-program/system, @solana-program/token, better-sqlite3, vitest, Docker

**Reference:** Design doc at `docs/plans/2026-02-21-devsol-marketplace-design.md`

---

## Prerequisites (manual, before Task 1)

1. **Generate vanity keypair:** `solana-keygen grind --starts-with SOL:1 --ends-with DEV:1` — save to `~/Documents/secret/devsol-treasury.json`
2. **Fund treasury:** Ask RECTOR to send ~7000 devnet SOL to the vanity address
3. **USDC on mainnet:** Ensure treasury wallet has some USDC on mainnet for sell payouts
4. **Add env vars** to `~/Documents/secret/.env`:
   ```
   DEVSOL_TREASURY_KEYPAIR=<base58 or path to JSON>
   DEVSOL_X402_FACILITATOR_URL=https://x402.org/facilitator
   DEVSOL_PORT=3100
   ```

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `src/index.ts`
- Create: `src/config.ts`

**Step 1: Initialize project**

Run:
```bash
cd ~/local-dev/devsol
pnpm init
```

**Step 2: Install dependencies**

Run:
```bash
pnpm add hono @hono/node-server @x402/hono @x402/svm @x402/core @solana/kit @solana-program/system @solana-program/token better-sqlite3 uuid
pnpm add -D typescript vitest @types/better-sqlite3 @types/uuid tsx
```

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 4: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
    },
  },
});
```

**Step 5: Create .gitignore**

```
node_modules/
dist/
*.db
*.db-journal
.env
.env.local
```

**Step 6: Create .env.example**

```
# Treasury keypair (base58 private key or path to JSON file)
DEVSOL_TREASURY_KEYPAIR=

# x402 facilitator URL
DEVSOL_X402_FACILITATOR_URL=https://x402.org/facilitator

# Server port
DEVSOL_PORT=3100

# Solana RPC endpoints
DEVSOL_DEVNET_RPC=https://api.devnet.solana.com
DEVSOL_DEVNET_WSS=wss://api.devnet.solana.com
DEVSOL_MAINNET_RPC=https://api.mainnet-beta.solana.com
DEVSOL_MAINNET_WSS=wss://api.mainnet-beta.solana.com

# Pricing (USDC per SOL)
DEVSOL_BUY_PRICE=1.05
DEVSOL_SELL_PRICE=0.95

# SQLite database path
DEVSOL_DB_PATH=./devsol.db
```

**Step 7: Create src/config.ts**

```typescript
function env(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (!value) throw new Error(`Missing env var: ${key}`);
  return value;
}

export const config = {
  port: Number(env('DEVSOL_PORT', '3100')),
  treasuryKeypair: env('DEVSOL_TREASURY_KEYPAIR'),
  facilitatorUrl: env('DEVSOL_X402_FACILITATOR_URL', 'https://x402.org/facilitator'),
  devnetRpc: env('DEVSOL_DEVNET_RPC', 'https://api.devnet.solana.com'),
  devnetWss: env('DEVSOL_DEVNET_WSS', 'wss://api.devnet.solana.com'),
  mainnetRpc: env('DEVSOL_MAINNET_RPC', 'https://api.mainnet-beta.solana.com'),
  mainnetWss: env('DEVSOL_MAINNET_WSS', 'wss://api.mainnet-beta.solana.com'),
  buyPrice: Number(env('DEVSOL_BUY_PRICE', '1.05')),
  sellPrice: Number(env('DEVSOL_SELL_PRICE', '0.95')),
  dbPath: env('DEVSOL_DB_PATH', './devsol.db'),
  svmNetwork: env('DEVSOL_SVM_NETWORK', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'),
} as const;
```

**Step 8: Create src/index.ts**

```typescript
import { serve } from '@hono/node-server';
import { app } from './app';
import { config } from './config';

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`DevSOL running on http://localhost:${info.port}`);
});
```

**Step 9: Create src/app.ts (Hono app, separate from server for testing)**

```typescript
import { Hono } from 'hono';

export const app = new Hono();

app.get('/health', (c) => c.json({ status: 'ok' }));
```

**Step 10: Add scripts to package.json**

Update `package.json` scripts:
```json
{
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest",
    "test:run": "vitest run",
    "test:coverage": "vitest run --coverage"
  }
}
```

**Step 11: Write smoke test**

Create `src/app.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { app } from './app';

describe('DevSOL App', () => {
  it('GET /health returns ok', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });
});
```

**Step 12: Run test to verify it passes**

Run: `pnpm test:run`
Expected: PASS

**Step 13: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json vitest.config.ts .gitignore .env.example src/
git commit -m "feat: project scaffolding with Hono, TypeScript, vitest"
```

---

## Task 2: SQLite Database Layer

**Files:**
- Create: `src/db/sqlite.ts`
- Create: `src/db/sqlite.test.ts`

**Step 1: Write the failing test**

Create `src/db/sqlite.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TransactionDB, type Transaction } from './sqlite';

describe('TransactionDB', () => {
  let db: TransactionDB;

  beforeEach(() => {
    db = new TransactionDB(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('creates a buy transaction', () => {
    const tx = db.create({
      type: 'buy',
      wallet: '4KAFtvBGH2y2',
      sol_amount: 10,
      usdc_amount: 10.5,
    });
    expect(tx.id).toBeDefined();
    expect(tx.type).toBe('buy');
    expect(tx.status).toBe('pending');
  });

  it('retrieves a transaction by id', () => {
    const created = db.create({
      type: 'buy',
      wallet: '4KAFtvBGH2y2',
      sol_amount: 5,
      usdc_amount: 5.25,
    });
    const found = db.getById(created.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(created.id);
    expect(found!.sol_amount).toBe(5);
  });

  it('updates transaction status and tx hashes', () => {
    const tx = db.create({
      type: 'buy',
      wallet: '4KAFtvBGH2y2',
      sol_amount: 10,
      usdc_amount: 10.5,
    });
    db.update(tx.id, {
      status: 'completed',
      devnet_tx: '5abc_devnet_sig',
      mainnet_tx: '7def_mainnet_sig',
    });
    const updated = db.getById(tx.id);
    expect(updated!.status).toBe('completed');
    expect(updated!.devnet_tx).toBe('5abc_devnet_sig');
    expect(updated!.mainnet_tx).toBe('7def_mainnet_sig');
  });

  it('returns null for non-existent id', () => {
    const found = db.getById('nonexistent');
    expect(found).toBeNull();
  });

  it('finds pending sell transactions', () => {
    db.create({ type: 'sell', wallet: 'abc', sol_amount: 5, usdc_amount: 4.75 });
    db.create({ type: 'buy', wallet: 'def', sol_amount: 10, usdc_amount: 10.5 });
    db.create({ type: 'sell', wallet: 'ghi', sol_amount: 3, usdc_amount: 2.85 });

    const pending = db.findPendingSells();
    expect(pending).toHaveLength(2);
    expect(pending.every((t) => t.type === 'sell' && t.status === 'pending')).toBe(true);
  });

  it('prevents duplicate payment IDs', () => {
    db.create({
      type: 'buy',
      wallet: 'abc',
      sol_amount: 10,
      usdc_amount: 10.5,
      mainnet_tx: 'unique_payment',
    });
    expect(() =>
      db.create({
        type: 'buy',
        wallet: 'def',
        sol_amount: 5,
        usdc_amount: 5.25,
        mainnet_tx: 'unique_payment',
      }),
    ).toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test:run src/db/sqlite.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

Create `src/db/sqlite.ts`:
```typescript
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

export interface Transaction {
  id: string;
  type: 'buy' | 'sell';
  wallet: string;
  sol_amount: number;
  usdc_amount: number;
  mainnet_tx: string | null;
  devnet_tx: string | null;
  memo: string | null;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  created_at: string;
  updated_at: string;
}

export interface CreateTransactionInput {
  type: 'buy' | 'sell';
  wallet: string;
  sol_amount: number;
  usdc_amount: number;
  mainnet_tx?: string;
  devnet_tx?: string;
  memo?: string;
}

export interface UpdateTransactionInput {
  status?: Transaction['status'];
  mainnet_tx?: string;
  devnet_tx?: string;
}

export class TransactionDB {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS transactions (
        id          TEXT PRIMARY KEY,
        type        TEXT NOT NULL CHECK(type IN ('buy', 'sell')),
        wallet      TEXT NOT NULL,
        sol_amount  REAL NOT NULL,
        usdc_amount REAL NOT NULL,
        mainnet_tx  TEXT UNIQUE,
        devnet_tx   TEXT,
        memo        TEXT,
        status      TEXT NOT NULL DEFAULT 'pending'
                      CHECK(status IN ('pending', 'completed', 'failed', 'refunded')),
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
      CREATE INDEX IF NOT EXISTS idx_transactions_memo ON transactions(memo);
    `);
  }

  create(input: CreateTransactionInput): Transaction {
    const id = randomUUID();
    const stmt = this.db.prepare(`
      INSERT INTO transactions (id, type, wallet, sol_amount, usdc_amount, mainnet_tx, devnet_tx, memo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      input.type,
      input.wallet,
      input.sol_amount,
      input.usdc_amount,
      input.mainnet_tx ?? null,
      input.devnet_tx ?? null,
      input.memo ?? null,
    );
    return this.getById(id)!;
  }

  getById(id: string): Transaction | null {
    const stmt = this.db.prepare('SELECT * FROM transactions WHERE id = ?');
    return (stmt.get(id) as Transaction) ?? null;
  }

  update(id: string, input: UpdateTransactionInput): void {
    const sets: string[] = ['updated_at = datetime(\'now\')'];
    const values: unknown[] = [];

    if (input.status) {
      sets.push('status = ?');
      values.push(input.status);
    }
    if (input.mainnet_tx) {
      sets.push('mainnet_tx = ?');
      values.push(input.mainnet_tx);
    }
    if (input.devnet_tx) {
      sets.push('devnet_tx = ?');
      values.push(input.devnet_tx);
    }

    values.push(id);
    this.db.prepare(`UPDATE transactions SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  findPendingSells(): Transaction[] {
    return this.db
      .prepare("SELECT * FROM transactions WHERE type = 'sell' AND status = 'pending'")
      .all() as Transaction[];
  }

  findByMemo(memo: string): Transaction | null {
    const stmt = this.db.prepare('SELECT * FROM transactions WHERE memo = ?');
    return (stmt.get(memo) as Transaction) ?? null;
  }

  close() {
    this.db.close();
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test:run src/db/sqlite.test.ts`
Expected: All 6 tests PASS

**Step 5: Commit**

```bash
git add src/db/
git commit -m "feat: SQLite transaction log with CRUD operations"
```

---

## Task 3: Pricing Service

**Files:**
- Create: `src/services/pricing.ts`
- Create: `src/services/pricing.test.ts`

**Step 1: Write the failing test**

Create `src/services/pricing.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { PricingService } from './pricing';

describe('PricingService', () => {
  const pricing = new PricingService(1.05, 0.95);

  it('calculates buy cost in USDC', () => {
    expect(pricing.buyQuote(10)).toEqual({
      sol_amount: 10,
      usdc_amount: 10.5,
      rate: 1.05,
    });
  });

  it('calculates sell payout in USDC', () => {
    expect(pricing.sellQuote(10)).toEqual({
      sol_amount: 10,
      usdc_amount: 9.5,
      rate: 0.95,
    });
  });

  it('returns price summary', () => {
    const summary = pricing.summary();
    expect(summary.buy.usdc_per_sol).toBe(1.05);
    expect(summary.sell.usdc_per_sol).toBe(0.95);
    expect(summary.spread).toBeCloseTo(0.1);
  });

  it('rejects zero or negative amounts', () => {
    expect(() => pricing.buyQuote(0)).toThrow();
    expect(() => pricing.buyQuote(-5)).toThrow();
    expect(() => pricing.sellQuote(0)).toThrow();
  });

  it('rounds USDC amounts to 6 decimals (USDC precision)', () => {
    const quote = pricing.buyQuote(3.333333);
    expect(quote.usdc_amount).toBe(3.5);
    // 3.333333 * 1.05 = 3.49999965 → rounded to 6 decimals = 3.5
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test:run src/services/pricing.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

Create `src/services/pricing.ts`:
```typescript
export interface Quote {
  sol_amount: number;
  usdc_amount: number;
  rate: number;
}

export interface PriceSummary {
  buy: { sol_per_usdc: number; usdc_per_sol: number };
  sell: { sol_per_usdc: number; usdc_per_sol: number };
  spread: number;
}

export class PricingService {
  constructor(
    private buyRate: number,
    private sellRate: number,
  ) {}

  buyQuote(solAmount: number): Quote {
    if (solAmount <= 0) throw new Error('Amount must be positive');
    return {
      sol_amount: solAmount,
      usdc_amount: this.round(solAmount * this.buyRate),
      rate: this.buyRate,
    };
  }

  sellQuote(solAmount: number): Quote {
    if (solAmount <= 0) throw new Error('Amount must be positive');
    return {
      sol_amount: solAmount,
      usdc_amount: this.round(solAmount * this.sellRate),
      rate: this.sellRate,
    };
  }

  summary(): PriceSummary {
    return {
      buy: { sol_per_usdc: this.round(1 / this.buyRate), usdc_per_sol: this.buyRate },
      sell: { sol_per_usdc: this.round(1 / this.sellRate), usdc_per_sol: this.sellRate },
      spread: this.round(this.buyRate - this.sellRate),
    };
  }

  private round(n: number): number {
    return Math.round(n * 1_000_000) / 1_000_000;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test:run src/services/pricing.test.ts`
Expected: All 5 tests PASS

**Step 5: Commit**

```bash
git add src/services/pricing.ts src/services/pricing.test.ts
git commit -m "feat: pricing service with spread model"
```

---

## Task 4: Treasury Service (Devnet SOL Transfers)

**Files:**
- Create: `src/services/treasury.ts`
- Create: `src/services/treasury.test.ts`

**Step 1: Write the failing test**

Create `src/services/treasury.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TreasuryService } from './treasury';

// Mock @solana/kit — we don't want real RPC calls in unit tests
vi.mock('@solana/kit', () => ({
  createSolanaRpc: vi.fn(() => ({
    getBalance: vi.fn(() => ({
      send: vi.fn(async () => ({ value: 7000_000_000_000n })),
    })),
    getLatestBlockhash: vi.fn(() => ({
      send: vi.fn(async () => ({
        value: {
          blockhash: 'FakeBlockhash11111111111111111111111111111111' as any,
          lastValidBlockHeight: 1000n,
        },
      })),
    })),
  })),
  createSolanaRpcSubscriptions: vi.fn(() => ({})),
  sendAndConfirmTransactionFactory: vi.fn(() =>
    vi.fn(async () => undefined),
  ),
  createKeyPairSignerFromBytes: vi.fn(async () => ({
    address: 'SoLTreasuryAddressDevXXXXXXXXXXXXXXXXXXXXXXX' as any,
  })),
  address: vi.fn((addr: string) => addr),
  lamports: vi.fn((n: bigint) => n),
  pipe: vi.fn((...fns: any[]) => {
    let result = fns[0];
    for (let i = 1; i < fns.length; i++) result = fns[i](result);
    return result;
  }),
  createTransactionMessage: vi.fn(() => ({})),
  setTransactionMessageFeePayerSigner: vi.fn(() => () => ({})),
  setTransactionMessageLifetimeUsingBlockhash: vi.fn(() => () => ({})),
  appendTransactionMessageInstruction: vi.fn(() => () => ({})),
  signTransactionMessageWithSigners: vi.fn(async () => ({})),
  getSignatureFromTransaction: vi.fn(() => 'FakeSignature1111111111111111111111111111111111111'),
}));

vi.mock('@solana-program/system', () => ({
  getTransferSolInstruction: vi.fn(() => ({})),
}));

describe('TreasuryService', () => {
  let treasury: TreasuryService;

  beforeEach(async () => {
    treasury = await TreasuryService.create({
      rpcUrl: 'https://api.devnet.solana.com',
      wssUrl: 'wss://api.devnet.solana.com',
      keypairBytes: new Uint8Array(64),
    });
  });

  it('reports treasury address', () => {
    expect(treasury.address).toBeDefined();
    expect(typeof treasury.address).toBe('string');
  });

  it('gets balance in SOL', async () => {
    const balance = await treasury.getBalance();
    expect(balance).toBe(7000); // 7000_000_000_000 lamports = 7000 SOL
  });

  it('sends SOL to a recipient', async () => {
    const sig = await treasury.sendSol('RecipientAddress1111111111111111111111111', 10);
    expect(sig).toBeDefined();
    expect(typeof sig).toBe('string');
  });

  it('rejects zero or negative SOL amounts', async () => {
    await expect(treasury.sendSol('Recipient', 0)).rejects.toThrow();
    await expect(treasury.sendSol('Recipient', -5)).rejects.toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test:run src/services/treasury.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

Create `src/services/treasury.ts`:
```typescript
import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  sendAndConfirmTransactionFactory,
  createKeyPairSignerFromBytes,
  address,
  lamports,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  signTransactionMessageWithSigners,
  getSignatureFromTransaction,
  type KeyPairSigner,
  type Rpc,
  type SolanaRpcApi,
} from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';

const LAMPORTS_PER_SOL = 1_000_000_000n;

interface TreasuryConfig {
  rpcUrl: string;
  wssUrl: string;
  keypairBytes: Uint8Array;
}

export class TreasuryService {
  private constructor(
    private signer: KeyPairSigner,
    private rpc: Rpc<SolanaRpcApi>,
    private sendAndConfirm: ReturnType<typeof sendAndConfirmTransactionFactory>,
  ) {}

  static async create(cfg: TreasuryConfig): Promise<TreasuryService> {
    const rpc = createSolanaRpc(cfg.rpcUrl);
    const rpcSub = createSolanaRpcSubscriptions(cfg.wssUrl);
    const signer = await createKeyPairSignerFromBytes(cfg.keypairBytes);
    const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions: rpcSub });
    return new TreasuryService(signer, rpc, sendAndConfirm);
  }

  get address(): string {
    return this.signer.address;
  }

  async getBalance(): Promise<number> {
    const { value } = await this.rpc.getBalance(this.signer.address).send();
    return Number(value) / Number(LAMPORTS_PER_SOL);
  }

  async sendSol(recipient: string, solAmount: number): Promise<string> {
    if (solAmount <= 0) throw new Error('Amount must be positive');

    const lamportAmount = lamports(BigInt(Math.round(solAmount * Number(LAMPORTS_PER_SOL))));
    const { value: latestBlockhash } = await this.rpc.getLatestBlockhash().send();

    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(this.signer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
      (m) =>
        appendTransactionMessageInstruction(
          getTransferSolInstruction({
            source: this.signer,
            destination: address(recipient),
            amount: lamportAmount,
          }),
          m,
        ),
    );

    const signedTx = await signTransactionMessageWithSigners(message);
    const signature = getSignatureFromTransaction(signedTx);
    await this.sendAndConfirm(signedTx, { commitment: 'confirmed' });
    return signature;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test:run src/services/treasury.test.ts`
Expected: All 4 tests PASS

**Step 5: Commit**

```bash
git add src/services/treasury.ts src/services/treasury.test.ts
git commit -m "feat: treasury service for devnet SOL transfers via @solana/kit"
```

---

## Task 5: Hono App + Info Endpoints

**Files:**
- Modify: `src/app.ts`
- Create: `src/routes/price.ts`
- Create: `src/routes/treasury.ts`
- Create: `src/routes/tx.ts`
- Create: `src/routes/price.test.ts`
- Create: `src/routes/treasury.test.ts`
- Create: `src/routes/tx.test.ts`

**Step 1: Write failing tests**

Create `src/routes/price.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { priceRoutes } from './price';
import { PricingService } from '../services/pricing';

describe('GET /price', () => {
  const app = new Hono();
  const pricing = new PricingService(1.05, 0.95);
  app.route('/', priceRoutes(pricing));

  it('returns price summary', async () => {
    const res = await app.request('/price');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.buy.usdc_per_sol).toBe(1.05);
    expect(body.sell.usdc_per_sol).toBe(0.95);
    expect(body.spread).toBeCloseTo(0.1);
  });
});
```

Create `src/routes/treasury.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { treasuryRoutes } from './treasury';

const mockTreasury = {
  address: 'SoLTreasury1111',
  getBalance: vi.fn(async () => 6842.5),
};

describe('GET /treasury', () => {
  const app = new Hono();
  app.route('/', treasuryRoutes(mockTreasury as any));

  it('returns treasury info', async () => {
    const res = await app.request('/treasury');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.address).toBe('SoLTreasury1111');
    expect(body.balance_sol).toBe(6842.5);
    expect(body.status).toBe('active');
  });
});
```

Create `src/routes/tx.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { txRoutes } from './tx';
import { TransactionDB } from '../db/sqlite';

describe('GET /tx/:id', () => {
  let db: TransactionDB;
  let app: Hono;

  beforeEach(() => {
    db = new TransactionDB(':memory:');
    app = new Hono();
    app.route('/', txRoutes(db));
  });

  afterEach(() => db.close());

  it('returns a transaction by id', async () => {
    const tx = db.create({ type: 'buy', wallet: 'abc', sol_amount: 10, usdc_amount: 10.5 });
    const res = await app.request(`/tx/${tx.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(tx.id);
    expect(body.type).toBe('buy');
  });

  it('returns 404 for unknown id', async () => {
    const res = await app.request('/tx/nonexistent');
    expect(res.status).toBe(404);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm test:run src/routes/`
Expected: FAIL — modules not found

**Step 3: Write implementations**

Create `src/routes/price.ts`:
```typescript
import { Hono } from 'hono';
import type { PricingService } from '../services/pricing';

export function priceRoutes(pricing: PricingService) {
  const router = new Hono();
  router.get('/price', (c) => c.json(pricing.summary()));
  return router;
}
```

Create `src/routes/treasury.ts`:
```typescript
import { Hono } from 'hono';
import type { TreasuryService } from '../services/treasury';

export function treasuryRoutes(treasury: TreasuryService) {
  const router = new Hono();

  router.get('/treasury', async (c) => {
    const balance = await treasury.getBalance();
    return c.json({
      address: treasury.address,
      balance_sol: balance,
      status: balance > 0 ? 'active' : 'depleted',
    });
  });

  return router;
}
```

Create `src/routes/tx.ts`:
```typescript
import { Hono } from 'hono';
import type { TransactionDB } from '../db/sqlite';

export function txRoutes(db: TransactionDB) {
  const router = new Hono();

  router.get('/tx/:id', (c) => {
    const tx = db.getById(c.req.param('id'));
    if (!tx) return c.json({ error: 'Transaction not found' }, 404);
    return c.json(tx);
  });

  return router;
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm test:run src/routes/`
Expected: All tests PASS

**Step 5: Wire routes into app.ts**

Update `src/app.ts`:
```typescript
import { Hono } from 'hono';
import { priceRoutes } from './routes/price';
import { treasuryRoutes } from './routes/treasury';
import { txRoutes } from './routes/tx';
import { PricingService } from './services/pricing';
import { TreasuryService } from './services/treasury';
import { TransactionDB } from './db/sqlite';
import { config } from './config';

export async function createApp(deps?: {
  pricing?: PricingService;
  treasury?: TreasuryService;
  db?: TransactionDB;
}) {
  const pricing = deps?.pricing ?? new PricingService(config.buyPrice, config.sellPrice);
  const db = deps?.db ?? new TransactionDB(config.dbPath);

  const app = new Hono();
  app.get('/health', (c) => c.json({ status: 'ok' }));
  app.route('/', priceRoutes(pricing));
  app.route('/', txRoutes(db));

  // Treasury requires async init — optional for testing without real RPC
  if (deps?.treasury) {
    app.route('/', treasuryRoutes(deps.treasury));
  }

  return { app, db, pricing };
}
```

Update `src/index.ts`:
```typescript
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { TreasuryService } from './services/treasury';
import { config } from './config';
import { readFileSync } from 'fs';

async function main() {
  // Load treasury keypair
  const keypairJson = readFileSync(config.treasuryKeypair, 'utf-8');
  const keypairBytes = new Uint8Array(JSON.parse(keypairJson));

  const treasury = await TreasuryService.create({
    rpcUrl: config.devnetRpc,
    wssUrl: config.devnetWss,
    keypairBytes,
  });

  const { app } = await createApp({ treasury });

  serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`DevSOL running on http://localhost:${info.port}`);
    console.log(`Treasury: ${treasury.address}`);
  });
}

main().catch(console.error);
```

Update `src/app.test.ts` to use the new async factory:
```typescript
import { describe, it, expect } from 'vitest';
import { createApp } from './app';
import { PricingService } from './services/pricing';
import { TransactionDB } from './db/sqlite';

describe('DevSOL App', () => {
  it('GET /health returns ok', async () => {
    const db = new TransactionDB(':memory:');
    const pricing = new PricingService(1.05, 0.95);
    const { app } = await createApp({ pricing, db });
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    db.close();
  });
});
```

**Step 6: Run all tests**

Run: `pnpm test:run`
Expected: All tests PASS

**Step 7: Commit**

```bash
git add src/routes/ src/app.ts src/app.test.ts src/index.ts
git commit -m "feat: GET /price, /treasury, /tx/:id endpoints"
```

---

## Task 6: Buy Endpoint with x402

**Files:**
- Create: `src/routes/buy.ts`
- Create: `src/routes/buy.test.ts`
- Create: `src/services/x402.ts`
- Create: `src/services/x402.test.ts`

The buy endpoint uses x402 protocol for dynamic pricing. Since the middleware's route config uses static prices and we need amount-based pricing, we implement the x402 flow manually:
1. No payment header → respond 402 with payment instructions
2. Payment header present → verify via facilitator → deliver SOL

**Step 1: Write failing test for x402 service**

Create `src/services/x402.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { X402Service } from './x402';

describe('X402Service', () => {
  const mockFacilitator = {
    verify: vi.fn(),
  };

  const service = new X402Service({
    facilitator: mockFacilitator as any,
    payTo: 'TreasuryMainnetAddress',
    network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  });

  it('creates 402 response payload', () => {
    const payload = service.createPaymentRequired(10.5, 'Buy 10 SOL devnet');
    expect(payload.x402Version).toBe(2);
    expect(payload.accepts).toHaveLength(1);
    expect(payload.accepts[0].price).toBe('$10.5');
    expect(payload.accepts[0].scheme).toBe('exact');
    expect(payload.accepts[0].network).toBe('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp');
  });

  it('verifies a valid payment', async () => {
    mockFacilitator.verify.mockResolvedValue({ valid: true });
    const result = await service.verifyPayment('payment-proof-header', 10.5);
    expect(result.valid).toBe(true);
  });

  it('rejects an invalid payment', async () => {
    mockFacilitator.verify.mockResolvedValue({ valid: false, reason: 'insufficient' });
    const result = await service.verifyPayment('bad-proof', 10.5);
    expect(result.valid).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test:run src/services/x402.test.ts`
Expected: FAIL — module not found

**Step 3: Write x402 service**

Create `src/services/x402.ts`:
```typescript
interface X402Config {
  facilitator: { verify: (proof: string, opts: any) => Promise<{ valid: boolean; reason?: string }> };
  payTo: string;
  network: string;
}

interface PaymentRequiredPayload {
  x402Version: number;
  accepts: Array<{
    scheme: string;
    price: string;
    network: string;
    payTo: string;
  }>;
  description: string;
}

interface VerifyResult {
  valid: boolean;
  reason?: string;
}

export class X402Service {
  constructor(private cfg: X402Config) {}

  createPaymentRequired(usdcAmount: number, description: string): PaymentRequiredPayload {
    return {
      x402Version: 2,
      accepts: [
        {
          scheme: 'exact',
          price: `$${usdcAmount}`,
          network: this.cfg.network,
          payTo: this.cfg.payTo,
        },
      ],
      description,
    };
  }

  async verifyPayment(paymentHeader: string, expectedUsdc: number): Promise<VerifyResult> {
    return this.cfg.facilitator.verify(paymentHeader, {
      price: `$${expectedUsdc}`,
      network: this.cfg.network,
      payTo: this.cfg.payTo,
    });
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test:run src/services/x402.test.ts`
Expected: All 3 tests PASS

**Step 5: Write failing test for buy route**

Create `src/routes/buy.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { buyRoutes } from './buy';
import { TransactionDB } from '../db/sqlite';
import { PricingService } from '../services/pricing';

const mockTreasury = {
  address: 'TreasuryAddr',
  sendSol: vi.fn(async () => 'devnet_sig_123'),
  getBalance: vi.fn(async () => 5000),
};

const mockX402 = {
  createPaymentRequired: vi.fn(() => ({
    x402Version: 2,
    accepts: [{ scheme: 'exact', price: '$10.5', network: 'solana:test', payTo: 'pay' }],
    description: 'Buy 10 SOL',
  })),
  verifyPayment: vi.fn(async () => ({ valid: true })),
};

describe('POST /buy', () => {
  let db: TransactionDB;
  let app: Hono;
  const pricing = new PricingService(1.05, 0.95);

  beforeEach(() => {
    db = new TransactionDB(':memory:');
    app = new Hono();
    app.route('/', buyRoutes({ db, pricing, treasury: mockTreasury as any, x402: mockX402 as any }));
    vi.clearAllMocks();
  });

  afterEach(() => db.close());

  it('returns 402 when no payment header', async () => {
    const res = await app.request('/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: 'BuyerWallet', amount_sol: 10 }),
    });
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.x402Version).toBe(2);
    expect(mockX402.createPaymentRequired).toHaveBeenCalledWith(10.5, expect.any(String));
  });

  it('validates request body', async () => {
    const res = await app.request('/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: 'BuyerWallet' }),
    });
    expect(res.status).toBe(400);
  });

  it('processes buy with valid payment', async () => {
    const res = await app.request('/buy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-PAYMENT': 'valid-payment-proof',
      },
      body: JSON.stringify({ wallet: 'BuyerWallet', amount_sol: 10 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe('buy');
    expect(body.sol_amount).toBe(10);
    expect(body.status).toBe('completed');
    expect(body.devnet_tx).toBe('devnet_sig_123');
    expect(mockTreasury.sendSol).toHaveBeenCalledWith('BuyerWallet', 10);
  });

  it('returns 402 for invalid payment', async () => {
    mockX402.verifyPayment.mockResolvedValueOnce({ valid: false, reason: 'bad proof' });
    const res = await app.request('/buy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-PAYMENT': 'invalid-proof',
      },
      body: JSON.stringify({ wallet: 'BuyerWallet', amount_sol: 10 }),
    });
    expect(res.status).toBe(402);
  });
});
```

**Step 6: Run test to verify it fails**

Run: `pnpm test:run src/routes/buy.test.ts`
Expected: FAIL — module not found

**Step 7: Write buy route implementation**

Create `src/routes/buy.ts`:
```typescript
import { Hono } from 'hono';
import type { TransactionDB } from '../db/sqlite';
import type { PricingService } from '../services/pricing';
import type { TreasuryService } from '../services/treasury';
import type { X402Service } from '../services/x402';

interface BuyDeps {
  db: TransactionDB;
  pricing: PricingService;
  treasury: TreasuryService;
  x402: X402Service;
}

export function buyRoutes({ db, pricing, treasury, x402 }: BuyDeps) {
  const router = new Hono();

  router.post('/buy', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body?.wallet || !body?.amount_sol || body.amount_sol <= 0) {
      return c.json({ error: 'Invalid request: wallet and positive amount_sol required' }, 400);
    }

    const { wallet, amount_sol } = body;
    const quote = pricing.buyQuote(amount_sol);

    // Check for x402 payment header
    const paymentHeader = c.req.header('X-PAYMENT');

    if (!paymentHeader) {
      // No payment — return 402 with payment instructions
      const payload = x402.createPaymentRequired(
        quote.usdc_amount,
        `Buy ${amount_sol} SOL devnet`,
      );
      return c.json(payload, 402);
    }

    // Verify payment
    const verification = await x402.verifyPayment(paymentHeader, quote.usdc_amount);
    if (!verification.valid) {
      const payload = x402.createPaymentRequired(
        quote.usdc_amount,
        `Payment invalid: ${verification.reason ?? 'unknown'}`,
      );
      return c.json(payload, 402);
    }

    // Payment verified — create transaction and deliver SOL
    const tx = db.create({
      type: 'buy',
      wallet,
      sol_amount: amount_sol,
      usdc_amount: quote.usdc_amount,
      mainnet_tx: paymentHeader,
    });

    try {
      const devnetSig = await treasury.sendSol(wallet, amount_sol);
      db.update(tx.id, { status: 'completed', devnet_tx: devnetSig });
      return c.json({ ...db.getById(tx.id) });
    } catch (err) {
      db.update(tx.id, { status: 'failed' });
      return c.json({ error: 'Delivery failed', transaction_id: tx.id }, 500);
    }
  });

  return router;
}
```

**Step 8: Run tests to verify they pass**

Run: `pnpm test:run src/routes/buy.test.ts src/services/x402.test.ts`
Expected: All tests PASS

**Step 9: Commit**

```bash
git add src/services/x402.ts src/services/x402.test.ts src/routes/buy.ts src/routes/buy.test.ts
git commit -m "feat: POST /buy endpoint with x402 payment verification"
```

---

## Task 7: Sell Order Endpoint

**Files:**
- Create: `src/routes/sell.ts`
- Create: `src/routes/sell.test.ts`

The sell flow is two-phase:
1. POST /sell creates a pending sell order → returns treasury address + memo
2. Background deposit detector (Task 8) confirms deposits and triggers USDC payout

**Step 1: Write the failing test**

Create `src/routes/sell.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { sellRoutes } from './sell';
import { TransactionDB } from '../db/sqlite';
import { PricingService } from '../services/pricing';

describe('POST /sell', () => {
  let db: TransactionDB;
  let app: Hono;
  const pricing = new PricingService(1.05, 0.95);
  const treasuryAddress = 'SoLTreasuryDEV1111';

  beforeEach(() => {
    db = new TransactionDB(':memory:');
    app = new Hono();
    app.route('/', sellRoutes({ db, pricing, treasuryAddress }));
  });

  afterEach(() => db.close());

  it('creates a pending sell order and returns deposit info', async () => {
    const res = await app.request('/sell', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: 'SellerWallet', amount_sol: 10 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('pending');
    expect(body.deposit_address).toBe(treasuryAddress);
    expect(body.memo).toBeDefined();
    expect(body.usdc_payout).toBe(9.5);
    expect(body.instructions).toContain('memo');
  });

  it('validates request body', async () => {
    const res = await app.request('/sell', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: 'SellerWallet' }),
    });
    expect(res.status).toBe(400);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test:run src/routes/sell.test.ts`
Expected: FAIL

**Step 3: Write implementation**

Create `src/routes/sell.ts`:
```typescript
import { Hono } from 'hono';
import { randomUUID } from 'crypto';
import type { TransactionDB } from '../db/sqlite';
import type { PricingService } from '../services/pricing';

interface SellDeps {
  db: TransactionDB;
  pricing: PricingService;
  treasuryAddress: string;
}

export function sellRoutes({ db, pricing, treasuryAddress }: SellDeps) {
  const router = new Hono();

  router.post('/sell', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body?.wallet || !body?.amount_sol || body.amount_sol <= 0) {
      return c.json({ error: 'Invalid request: wallet and positive amount_sol required' }, 400);
    }

    const { wallet, amount_sol } = body;
    const quote = pricing.sellQuote(amount_sol);
    const memo = `devsol-${randomUUID().slice(0, 8)}`;

    const tx = db.create({
      type: 'sell',
      wallet,
      sol_amount: amount_sol,
      usdc_amount: quote.usdc_amount,
      memo,
    });

    return c.json({
      transaction_id: tx.id,
      status: 'pending',
      deposit_address: treasuryAddress,
      memo,
      amount_sol,
      usdc_payout: quote.usdc_amount,
      instructions: `Send exactly ${amount_sol} SOL to ${treasuryAddress} on Solana devnet with memo: ${memo}`,
    });
  });

  return router;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test:run src/routes/sell.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/routes/sell.ts src/routes/sell.test.ts
git commit -m "feat: POST /sell endpoint with deposit instructions"
```

---

## Task 8: Deposit Detection Service

**Files:**
- Create: `src/services/deposit.ts`
- Create: `src/services/deposit.test.ts`

Polls devnet for SOL transfers to treasury with matching memos. When detected, marks the sell order as completed. USDC payout is a future enhancement (requires mainnet SPL Token transfer).

**Step 1: Write the failing test**

Create `src/services/deposit.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DepositDetector } from './deposit';
import { TransactionDB } from '../db/sqlite';

describe('DepositDetector', () => {
  let db: TransactionDB;
  const mockRpc = {
    getSignaturesForAddress: vi.fn(() => ({
      send: vi.fn(async () => []),
    })),
    getTransaction: vi.fn(() => ({
      send: vi.fn(async () => null),
    })),
  };

  beforeEach(() => {
    db = new TransactionDB(':memory:');
  });

  afterEach(() => db.close());

  it('finds pending sell orders to check', () => {
    db.create({ type: 'sell', wallet: 'abc', sol_amount: 5, usdc_amount: 4.75, memo: 'devsol-abc' });
    db.create({ type: 'buy', wallet: 'def', sol_amount: 10, usdc_amount: 10.5 });

    const detector = new DepositDetector({
      db,
      rpc: mockRpc as any,
      treasuryAddress: 'TreasuryAddr',
      onDeposit: vi.fn(),
    });

    const pending = db.findPendingSells();
    expect(pending).toHaveLength(1);
    expect(pending[0].memo).toBe('devsol-abc');
  });

  it('calls onDeposit when deposit is confirmed', async () => {
    const onDeposit = vi.fn();
    const tx = db.create({
      type: 'sell',
      wallet: 'seller1',
      sol_amount: 5,
      usdc_amount: 4.75,
      memo: 'devsol-test123',
    });

    const detector = new DepositDetector({
      db,
      rpc: mockRpc as any,
      treasuryAddress: 'TreasuryAddr',
      onDeposit,
    });

    // Simulate deposit detection
    await detector.processDeposit(tx.id, 'devnet_deposit_sig');
    expect(onDeposit).toHaveBeenCalledWith(
      expect.objectContaining({ id: tx.id, type: 'sell' }),
      'devnet_deposit_sig',
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test:run src/services/deposit.test.ts`
Expected: FAIL

**Step 3: Write implementation**

Create `src/services/deposit.ts`:
```typescript
import type { TransactionDB, Transaction } from '../db/sqlite';

interface DepositConfig {
  db: TransactionDB;
  rpc: any; // Solana devnet RPC
  treasuryAddress: string;
  onDeposit: (tx: Transaction, devnetSig: string) => void | Promise<void>;
  pollIntervalMs?: number;
}

export class DepositDetector {
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(private cfg: DepositConfig) {}

  start() {
    const intervalMs = this.cfg.pollIntervalMs ?? 15_000;
    this.interval = setInterval(() => this.poll(), intervalMs);
    console.log(`Deposit detector started (polling every ${intervalMs}ms)`);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async poll() {
    const pendingSells = this.cfg.db.findPendingSells();
    if (pendingSells.length === 0) return;

    try {
      const sigs = await this.cfg.rpc
        .getSignaturesForAddress(this.cfg.treasuryAddress, { limit: 50 })
        .send();

      for (const sig of sigs) {
        if (sig.memo) {
          const matching = pendingSells.find((tx) => sig.memo?.includes(tx.memo!));
          if (matching) {
            await this.processDeposit(matching.id, sig.signature);
          }
        }
      }
    } catch (err) {
      console.error('Deposit poll error:', err);
    }
  }

  async processDeposit(txId: string, devnetSig: string) {
    const tx = this.cfg.db.getById(txId);
    if (!tx || tx.status !== 'pending') return;

    this.cfg.db.update(txId, { status: 'completed', devnet_tx: devnetSig });
    await this.cfg.onDeposit(tx, devnetSig);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test:run src/services/deposit.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/services/deposit.ts src/services/deposit.test.ts
git commit -m "feat: deposit detection service for sell flow"
```

---

## Task 9: Wire Everything Together + Rate Limiting

**Files:**
- Modify: `src/app.ts`
- Modify: `src/index.ts`
- Modify: `src/app.test.ts`

**Step 1: Update app.ts with all routes and middleware**

```typescript
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { priceRoutes } from './routes/price';
import { treasuryRoutes } from './routes/treasury';
import { txRoutes } from './routes/tx';
import { buyRoutes } from './routes/buy';
import { sellRoutes } from './routes/sell';
import { PricingService } from './services/pricing';
import { TreasuryService } from './services/treasury';
import { TransactionDB } from './db/sqlite';
import { X402Service } from './services/x402';
import { config } from './config';

interface AppDeps {
  pricing?: PricingService;
  treasury?: TreasuryService;
  db?: TransactionDB;
  x402?: X402Service;
}

export async function createApp(deps?: AppDeps) {
  const pricing = deps?.pricing ?? new PricingService(config.buyPrice, config.sellPrice);
  const db = deps?.db ?? new TransactionDB(config.dbPath);

  const app = new Hono();

  // Middleware
  app.use('*', cors());
  app.use('*', logger());

  // Rate limiting (simple in-memory)
  const rateLimits = new Map<string, { count: number; resetAt: number }>();
  app.use('*', async (c, next) => {
    const ip = c.req.header('x-forwarded-for') ?? 'unknown';
    const now = Date.now();
    const entry = rateLimits.get(ip);
    if (entry && entry.resetAt > now) {
      if (entry.count >= 60) {
        return c.json({ error: 'Rate limit exceeded' }, 429);
      }
      entry.count++;
    } else {
      rateLimits.set(ip, { count: 1, resetAt: now + 60_000 });
    }
    await next();
  });

  // Routes
  app.get('/health', (c) => c.json({ status: 'ok' }));
  app.route('/', priceRoutes(pricing));
  app.route('/', txRoutes(db));

  if (deps?.treasury && deps?.x402) {
    app.route('/', treasuryRoutes(deps.treasury));
    app.route('/', buyRoutes({ db, pricing, treasury: deps.treasury, x402: deps.x402 }));
    app.route('/', sellRoutes({ db, pricing, treasuryAddress: deps.treasury.address }));
  }

  return { app, db, pricing };
}
```

**Step 2: Update index.ts with full bootstrap**

```typescript
import { serve } from '@hono/node-server';
import { readFileSync } from 'fs';
import { createApp } from './app';
import { TreasuryService } from './services/treasury';
import { X402Service } from './services/x402';
import { DepositDetector } from './services/deposit';
import { config } from './config';

async function main() {
  const keypairJson = readFileSync(config.treasuryKeypair, 'utf-8');
  const keypairBytes = new Uint8Array(JSON.parse(keypairJson));

  const treasury = await TreasuryService.create({
    rpcUrl: config.devnetRpc,
    wssUrl: config.devnetWss,
    keypairBytes,
  });

  // x402 service — facilitator client will be initialized from @x402/core
  // For now, placeholder that will be wired with HTTPFacilitatorClient
  const x402 = new X402Service({
    facilitator: {
      verify: async () => ({ valid: true }), // TODO: wire real facilitator
    },
    payTo: treasury.address,
    network: config.svmNetwork,
  });

  const { app, db } = await createApp({ treasury, x402 });

  // Start deposit detection for sell flow
  const depositDetector = new DepositDetector({
    db,
    rpc: null as any, // TODO: wire devnet RPC for deposit polling
    treasuryAddress: treasury.address,
    onDeposit: async (tx, sig) => {
      console.log(`Deposit confirmed for sell ${tx.id}: ${sig}`);
      // TODO: trigger USDC payout on mainnet
    },
  });
  depositDetector.start();

  serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`DevSOL running on http://localhost:${info.port}`);
    console.log(`Treasury: ${treasury.address}`);
  });
}

main().catch(console.error);
```

**Step 3: Run all tests**

Run: `pnpm test:run`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add src/app.ts src/index.ts src/app.test.ts
git commit -m "feat: wire all routes, rate limiting, full bootstrap"
```

---

## Task 10: Dockerfile + Docker Compose

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`

**Step 1: Create Dockerfile**

```dockerfile
FROM node:22-slim AS base
RUN corepack enable pnpm

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

FROM base AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src/ src/
RUN pnpm build

FROM base AS runtime
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

ENV NODE_ENV=production
EXPOSE 3100

CMD ["node", "dist/index.js"]
```

**Step 2: Create docker-compose.yml**

```yaml
name: devsol

services:
  api:
    build: .
    image: ghcr.io/rector-labs/devsol:latest
    container_name: devsol-api
    restart: unless-stopped
    ports:
      - "${DEVSOL_PORT:-3100}:3100"
    volumes:
      - devsol-data:/app/data
    env_file:
      - .env
    environment:
      - DEVSOL_DB_PATH=/app/data/devsol.db

volumes:
  devsol-data:
```

**Step 3: Verify Docker build**

Run: `docker build -t devsol:test .`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add Dockerfile docker-compose.yml
git commit -m "feat: Dockerfile and docker-compose for deployment"
```

---

## Task 11: GitHub Actions Deploy Workflow

**Files:**
- Create: `.github/workflows/deploy.yml`

**Step 1: Create deploy workflow**

```yaml
name: Deploy

on:
  push:
    branches: [main]

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: latest
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:run

  build-and-deploy:
    needs: test
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4

      - uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - uses: docker/metadata-action@v5
        id: meta
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=sha
            type=raw,value=latest

      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}

      - name: Deploy to VPS
        uses: appleboy/ssh-action@v1
        with:
          host: 176.222.53.185
          username: devsol
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd ~/devsol
            docker compose pull
            docker compose up -d
            docker image prune -f
```

**Step 2: Commit**

```bash
git add .github/
git commit -m "feat: GitHub Actions CI/CD deploy workflow"
```

---

## Task 12: Claude Code Skill (devsol:buy)

**Files:**
- Create: `~/.claude/skills/devsol/buy.md` (in RECTOR's dotfiles, not this repo)
- Create: `docs/skill-example.md` (reference in repo)

**Step 1: Create the skill file**

Create `~/.claude/skills/devsol/buy.md`:
```markdown
---
name: buy
description: Buy Solana devnet SOL instantly using x402 USDC payment
---

# DevSOL Buy Skill

Buy devnet SOL from the DevSOL marketplace at devsol.rectorspace.com.

## Usage

When a user needs devnet SOL (e.g., for testing, deploying programs, funding wallets):

1. **Check price:**
   ```bash
   curl -s https://devsol.rectorspace.com/price | jq
   ```

2. **Check treasury balance:**
   ```bash
   curl -s https://devsol.rectorspace.com/treasury | jq
   ```

3. **Buy SOL** (requires x402 payment — tell the user the USDC cost):
   ```bash
   curl -X POST https://devsol.rectorspace.com/buy \
     -H "Content-Type: application/json" \
     -d '{"wallet": "<DEVNET_WALLET>", "amount_sol": <AMOUNT>}'
   ```
   - First call returns 402 with USDC payment instructions
   - After payment, resend with `X-PAYMENT` header containing proof

4. **Check transaction:**
   ```bash
   curl -s https://devsol.rectorspace.com/tx/<ID> | jq
   ```

## Pricing

- **Buy rate:** 1 SOL devnet = $1.05 USDC
- **Sell rate:** 1 SOL devnet = $0.95 USDC
- Payment: USDC on Solana mainnet via x402 protocol
```

**Step 2: Create in-repo reference**

Create `docs/skill-example.md`:
```markdown
# DevSOL Claude Code Skill

The `devsol:buy` skill is installed at `~/.claude/skills/devsol/buy.md`.

It allows Claude Code agents to programmatically acquire devnet SOL during development sessions.

See the API docs at `GET /price` and `POST /buy` for the full protocol.
```

**Step 3: Commit**

```bash
git add docs/skill-example.md
git commit -m "docs: Claude Code skill reference for devsol:buy"
```

---

## Task 13: VPS Setup (manual, documented)

> **Not code — operational checklist for RECTOR**

1. **Create VPS user:**
   ```bash
   ssh reclabs
   sudo adduser devsol
   sudo usermod -aG docker devsol
   ```

2. **Reserve port** in `~/.ssh/vps-port-registry.md`: add `3100 — devsol`

3. **SSH config** — add to `~/.ssh/config`:
   ```
   Host reclabs-devsol
     HostName 176.222.53.185
     User devsol
     Port 22
   ```

4. **Nginx config** on VPS (`/etc/nginx/sites-available/devsol`):
   ```nginx
   server {
       listen 80;
       server_name devsol.rectorspace.com;

       location / {
           proxy_pass http://127.0.0.1:3100;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```

5. **SSL:** `sudo certbot --nginx -d devsol.rectorspace.com`

6. **DNS:** Add A record `devsol.rectorspace.com → 176.222.53.185`

7. **GitHub secrets:** Add `VPS_SSH_KEY` to repo settings

8. **Treasury keypair:** Copy to VPS:
   ```bash
   scp ~/Documents/secret/devsol-treasury.json reclabs-devsol:~/devsol/treasury.json
   ```

---

## Open Questions (resolve during implementation)

- [ ] **Vanity keypair grinding time:** `solana-keygen grind --starts-with SOL:1 --ends-with DEV:1` — test how long this takes. May need to relax pattern.
- [ ] **x402 facilitator URL:** Confirm exact URL from Coinbase/x402 docs. May need to self-host facilitator.
- [ ] **x402 SVM mainnet network ID:** Confirm `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` is correct for mainnet USDC.
- [ ] **USDC payout for sell flow:** Requires @solana-program/token SPL transfer on mainnet. Deferred to post-MVP — sell orders marked as "completed" but payout is manual initially.
- [ ] **Deposit detection accuracy:** memo-based matching via `getSignaturesForAddress` — verify memo field availability in Solana transaction metadata.
