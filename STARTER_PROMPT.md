# DevSOL — Implementation Starter Prompt

Copy the prompt below and paste it into a new Claude Code session opened in `~/local-dev/devsol/`.

---

## Prompt

```
Read the design document at docs/plans/2026-02-21-devsol-marketplace-design.md — this is the approved design for DevSOL, a Solana devnet SOL marketplace powered by x402 payments.

Use /superpowers:writing-plans to create a detailed implementation plan from this design, then execute it using /superpowers:executing-plans.

Key context:
- This is an API-first product (Hono + x402 middleware)
- Payment chain: Solana mainnet (USDC via @x402/svm)
- Delivery: instant auto-transfer of devnet SOL after payment verification
- Hosting: Docker on reclabs VPS (176.222.53.185), domain devsol.rectorspace.com
- DB: SQLite for transaction log
- Treasury: vanity keypair SOL...DEV (generate first with solana-keygen grind)

Implementation order:
1. Project scaffolding (pnpm, TypeScript, Hono, Docker)
2. Treasury service (devnet SOL transfers via @solana/kit)
3. x402 buy endpoint (POST /buy with @x402/hono middleware)
4. Sell flow (deposit detection + USDC payout)
5. Pricing + treasury info endpoints
6. SQLite transaction log
7. Dockerfile + docker-compose.yml + deploy workflow
8. Claude Code skill (devsol:buy) for agent usage
9. Tests for all services

Use Context7 MCP to look up @x402/hono, @x402/svm, and @solana/kit docs before implementing. Write tests for every service. One commit per feature.
```
