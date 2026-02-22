# DevSOL Roadmap

**Last updated:** 2026-02-22
**Current state:** Core API live (buy + sell E2E tested). API-only, no frontend.

---

## Phase 0: Infra (Immediate)

- [x] Add `mirror-gitlab.yml` workflow (force-push main to GitLab on every push)
- [ ] Update README.md with current API docs

---

## Phase 1: Hardening

Harden the existing backend before adding user-facing surfaces.

### 1.1 Transaction Expiry

- [x] Add `expires_at` column to transactions table (default: `created_at + 30 min`)
- [x] Cleanup job runs every 60s, marks expired pending orders as `expired`
- [x] Deposit detectors skip expired transactions in `findPendingBuys/Sells`
- [x] Add `expired` to valid status enum in schema

### 1.2 Amount Verification

- [x] Deposit detectors fetch on-chain transaction details after memo match
- [x] Verify actual transferred amount matches expected `usdc_amount` (buy) or `sol_amount` (sell)
- [x] Tolerance: exact match for USDC (atomic units), 0.1% for SOL (tx fees)
- [x] Amount mismatch: mark as `failed` with reason, don't deliver/payout

### 1.3 Monitoring & Logging

- [x] Replace `console.log/warn/error` with `pino` structured logger
- [x] Log levels: info (normal flow), warn (retries), error (failures)
- [x] Low balance alerts: log error when treasury SOL < 10 or payout USDC < 10
- [x] Extend `/health/detail` with `pending_orders` count

---

## Phase 2: Frontend + Claude Code Skill

Build user-facing surfaces. Frontend and skill can be developed in parallel.

### 2.1 Minimal Buy/Sell Widget

- [ ] React + Vite single-page app at `devsol.rectorspace.com`
- [ ] Solana wallet adapter (Phantom, Solflare, Backpack)
- [ ] Two-tab UI: Buy / Sell
- [ ] Flow: connect wallet -> enter amount -> see quote -> confirm -> send tx with memo -> poll status -> show result
- [ ] Tailwind CSS, clean utility-focused design
- [ ] Static files served by nginx (same VPS, separate from API)

### 2.2 Claude Code Skill

- [ ] `devsol:buy` skill — agent calls `POST /buy`, sends USDC tx, polls `/tx/:id`
- [ ] `devsol:sell` skill — agent calls `POST /sell`, sends devnet SOL tx, polls `/tx/:id`
- [ ] Skill `.md` files referencing existing API (no SDK needed)

---

## Phase 3: Growth

Additive features once the marketplace has users and volume.

### 3.1 Multi-Token Support

- [ ] Accept USDT alongside USDC for buy flow
- [ ] Payout in USDT or USDC (seller's choice)
- [ ] Token registry config, per-token ATA derivation, per-token pricing

### 3.2 Dynamic Pricing

- [ ] Adjust spread based on reserve levels (low SOL -> higher buy price, low USDC -> higher sell price)
- [ ] Optional: volume discounts, time-based pricing
- [ ] Deferred until sufficient volume warrants it

---

## Completed

- [x] Core marketplace API (buy + sell endpoints)
- [x] Direct USDC deposit buy flow (replaced x402 protocol)
- [x] Devnet SOL deposit sell flow with memo matching
- [x] Deposit detectors (BuyDepositDetector + DepositDetector)
- [x] Mainnet USDC payout service with retry + exponential backoff
- [x] Refund logic (both flows: USDC refund on failed SOL delivery, SOL refund on failed payout)
- [x] Rate limiting (60/min global, 10/min on buy/sell)
- [x] Balance pre-checks (treasury SOL for buy, payout USDC for sell)
- [x] Docker deployment on VPS with GitHub Actions CI
- [x] E2E test scripts (buy + sell, both verified live)
- [x] 112 unit tests across 16 test files
- [x] GitLab mirror workflow (Phase 0)
- [x] Transaction expiry with 30min TTL + cleanup job (Phase 1)
- [x] On-chain deposit amount verification (Phase 1)
- [x] Pino structured logging replacing all console.* (Phase 1)
- [x] Low balance alerts + pending_orders in /health/detail (Phase 1)
