import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { priceRoutes } from './routes/price.js';
import { treasuryRoutes } from './routes/treasury.js';
import { txRoutes } from './routes/tx.js';
import { buyRoutes } from './routes/buy.js';
import { sellRoutes } from './routes/sell.js';
import { PricingService } from './services/pricing.js';
import type { TreasuryService } from './services/treasury.js';
import type { X402Service } from './services/x402.js';
import type { PayoutService } from './services/payout.js';
import { TransactionDB } from './db/sqlite.js';
import { config } from './config.js';

const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_CLEANUP_THRESHOLD = 10_000;

interface AppDeps {
  pricing?: PricingService;
  treasury?: TreasuryService;
  db?: TransactionDB;
  x402?: X402Service;
  payout?: PayoutService;
}

export function createApp(deps?: AppDeps) {
  const pricing = deps?.pricing ?? new PricingService(config.buyPrice, config.sellPrice);
  const db = deps?.db ?? new TransactionDB(config.dbPath);

  const app = new Hono();

  // Middleware
  app.use('*', cors({ origin: config.corsOrigin }));
  app.use('*', logger());

  // Rate limiting (simple in-memory)
  const rateLimits = new Map<string, { count: number; resetAt: number }>();
  app.use('*', async (c, next) => {
    const forwarded = c.req.header('x-forwarded-for');
    const ip = forwarded ? forwarded.split(',').pop()!.trim() : 'unknown';
    const now = Date.now();
    const entry = rateLimits.get(ip);
    if (entry && entry.resetAt > now) {
      if (entry.count >= RATE_LIMIT_MAX) {
        return c.json({ error: 'Rate limit exceeded' }, 429);
      }
      entry.count++;
    } else {
      rateLimits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
      if (rateLimits.size > RATE_LIMIT_CLEANUP_THRESHOLD) {
        for (const [key, val] of rateLimits) {
          if (val.resetAt <= now) rateLimits.delete(key);
        }
      }
    }
    await next();
  });

  // Routes
  app.get('/health', (c) => c.json({ status: 'ok' }));
  app.route('/', priceRoutes(pricing));
  app.route('/', txRoutes(db));

  if (deps?.treasury && deps?.x402) {
    app.route('/', treasuryRoutes(deps.treasury, deps.payout));
    app.route('/', buyRoutes({ db, pricing, treasury: deps.treasury, x402: deps.x402 }));
    app.route('/', sellRoutes({ db, pricing, treasuryAddress: deps.treasury.address, payout: deps.payout }));
  }

  return { app, db, pricing };
}
