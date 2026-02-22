# DevSOL Production Readiness Design

**Date:** 2026-02-22
**Status:** Approved

## Overview

Make DevSOL a real marketplace by wiring real payment verification, real USDC payouts, and hardening the API. Three workstreams:

1. **x402 Facilitator Integration** — Replace stub with official x402.org facilitator
2. **Mainnet USDC Payout Service** — Auto-send USDC when devnet SOL deposits are confirmed
3. **Cleanup & Hardening** — Config fixes, pre-checks, error handling

## Workstream 1: x402 Facilitator Integration

### Current State

`index.ts` line 22: `verify: async () => ({ valid: true })` — all payments accepted without verification.

### Target State

Use `@x402/core` SDK's `HTTPFacilitatorClient` to verify and settle USDC payments via the official x402.org facilitator.

### Changes

**New dependency:** `@x402/core`

**`src/services/x402.ts`:**
- Import `HTTPFacilitatorClient` from `@x402/core/http`
- Update `X402Service` constructor to accept `HTTPFacilitatorClient` instance
- `verifyPayment()` decodes the `PAYMENT-SIGNATURE` header (base64 → PaymentPayload JSON), calls `facilitator.verify(paymentPayload, paymentRequirements)`
- Add `settlePayment()` method that calls `facilitator.settle()` — invoked async after SOL delivery
- `createPaymentRequired()` returns the proper x402 v2 payload for the `PAYMENT-REQUIRED` response header

**`src/routes/buy.ts`:**
- Update header name from `X-PAYMENT` to `PAYMENT-SIGNATURE` (per x402 spec)
- After successful SOL delivery, call `x402.settlePayment()` asynchronously (don't block the response)
- 402 response includes `PAYMENT-REQUIRED` header (base64-encoded)

**`src/index.ts`:**
- Replace stub facilitator with `new HTTPFacilitatorClient({ url: config.facilitatorUrl })`
- Remove the WARNING console.warn

### x402 Protocol Flow

```
Client → POST /buy (no payment header)
Server → 402 + PAYMENT-REQUIRED header (base64 PaymentRequired JSON)
Client → signs USDC payment, retries with PAYMENT-SIGNATURE header
Server → decode header, call facilitator.verify()
       → if invalid: 402 again with reason
       → if valid: send devnet SOL, call facilitator.settle() async
       → return 200 with transaction details + PAYMENT-RESPONSE header
```

## Workstream 2: Mainnet USDC Payout Service

### Architecture

```
DepositDetector → onDeposit() → PayoutService.sendUsdc() → mainnet USDC transfer
```

### New Service: `PayoutService`

**File:** `src/services/payout.ts`

**Dependencies:** `@solana-program/token` (for SPL token instructions)

**Responsibilities:**
- Hold a mainnet keypair signer (separate from devnet treasury)
- Send USDC to a recipient wallet on Solana mainnet
- Use `getTransferCheckedInstruction` (validates decimals on-chain)
- Use `getCreateAssociatedTokenIdempotentInstruction` for recipients without a USDC ATA
- Check USDC balance before sending

**Constants:**
- `USDC_MINT`: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- `USDC_DECIMALS`: 6

**Key method:**
```typescript
async sendUsdc(recipient: string, usdcAmount: number): Promise<string>
```
- Derives sender and recipient ATAs
- Creates recipient ATA idempotently
- Transfers USDC with checked instruction
- Returns mainnet transaction signature

**Balance check method:**
```typescript
async canAffordPayout(usdcAmount: number): Promise<boolean>
```
- Checks USDC token balance of hot wallet
- Returns true if balance >= usdcAmount + minReserve

### Safety Guardrails (env-configurable)

| Guard | Default | Env Var |
|-------|---------|---------|
| Max payout per tx | $100 USDC | `DEVSOL_MAX_PAYOUT_USDC` |
| Min reserve | $50 USDC | `DEVSOL_MIN_RESERVE_USDC` |

### Sell Flow (Updated)

```
POST /sell → payoutService.canAffordPayout(usdc_amount)
           → if NO  → 503 "Sell temporarily unavailable: insufficient reserves"
           → if YES → accept order, return memo + deposit instructions

DepositDetector → devnet SOL confirmed
               → payoutService.sendUsdc(wallet, usdc_amount)
               → if SUCCESS → mark completed, store mainnet_payout_tx
               → if FAIL   → mark failed, refund devnet SOL via treasury.sendSol()
```

### Principle: No Obligations

- No USDC available → reject sell at order time (503)
- Payout fails after deposit → auto-refund devnet SOL to user
- User always gets either USDC or their SOL back. Never stuck.
- No `payout_queued` status. Keep it simple: `pending` → `completed` or `failed`.

### Config Additions

- `DEVSOL_MAINNET_KEYPAIR` — path to mainnet USDC hot wallet keypair (required for sell flow)
- `DEVSOL_MAX_PAYOUT_USDC` — max single payout (default: 100)
- `DEVSOL_MIN_RESERVE_USDC` — minimum reserve to keep (default: 50)

### DB Schema Change

- Add `mainnet_payout_tx TEXT` column to transactions table (for storing USDC transfer signature on sell completion)

## Workstream 3: Cleanup & Hardening

### Config Fixes

- **Remove empty string default** for `treasuryKeypair` — crash early with clear error
- **Add `mainnetKeypair`** config entry — required, no fallback

### Pre-checks (Both Flows)

**Buy:** Check treasury devnet SOL balance >= requested amount before accepting x402 payment. No SOL = 503.

**Sell:** Already covered in Workstream 2.

### Health Endpoint

- Keep `/health` → `{"status":"ok"}` for load balancer
- Add `/health/detail` → `{"treasury_sol": 10, "payout_usdc": 500, "facilitator": "reachable"}` for monitoring

### Error Response Format

Consistent across all routes:
```json
{ "error": "Human-readable message", "code": "INSUFFICIENT_RESERVES" }
```

## New Dependencies Summary

| Package | Purpose |
|---------|---------|
| `@x402/core` | x402 facilitator client (verify + settle) |
| `@solana-program/token` | SPL token transfer instructions for USDC payout |

## Files Changed

| File | Change |
|------|--------|
| `src/services/x402.ts` | Rewrite: real facilitator, base64 header handling |
| `src/services/payout.ts` | **NEW**: Mainnet USDC payout service |
| `src/services/deposit.ts` | Update onDeposit to call payout + refund on failure |
| `src/routes/buy.ts` | x402 spec headers, balance pre-check, async settlement |
| `src/routes/sell.ts` | USDC pre-check, inject payout service |
| `src/routes/treasury.ts` | Add /health/detail endpoint |
| `src/index.ts` | Wire real facilitator + payout service |
| `src/config.ts` | Add mainnet keypair, payout limits, remove empty defaults |
| `src/db/sqlite.ts` | Add mainnet_payout_tx column, migration |
| `package.json` | Add @x402/core, @solana-program/token |
