import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { priceRoutes } from './routes/price.js';
import { treasuryRoutes } from './routes/treasury.js';
import { txRoutes } from './routes/tx.js';
import { statsRoutes } from './routes/stats.js';
import { buyRoutes } from './routes/buy.js';
import { sellRoutes } from './routes/sell.js';
import { feedbackRoutes } from './routes/feedback.js';
import { PricingService } from './services/pricing.js';
import type { TreasuryService } from './services/treasury.js';
import type { PayoutService } from './services/payout.js';
import { TransactionDB } from './db/sqlite.js';
import { FeedbackDB } from './db/feedback.js';
import { config } from './config.js';
import { createLogger } from './logger.js';

const log = createLogger('rate-limit');

const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_STRICT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_CLEANUP_INTERVAL = 100;

interface AppDeps {
  pricing?: PricingService;
  treasury?: TreasuryService;
  db?: TransactionDB;
  payout?: PayoutService;
  feedbackDb?: FeedbackDB;
}

export function createApp(deps?: AppDeps) {
  const pricing = deps?.pricing ?? new PricingService(config.buyPrice, config.sellPrice);
  const db = deps?.db ?? new TransactionDB(config.dbPath);
  const feedbackDb = deps?.feedbackDb ?? new FeedbackDB(config.dbPath);

  const app = new Hono();

  // Middleware
  app.use('*', cors({ origin: config.corsOrigin }));
  app.use('*', logger());

  // Rate limiting (simple in-memory)
  const rateLimits = new Map<string, { count: number; resetAt: number }>();
  const strictRateLimits = new Map<string, { count: number; resetAt: number }>();
  let requestCounter = 0;

  // First IP in X-Forwarded-For is the original client; subsequent entries
  // are proxies that appended themselves. Spoofable, but rate limiting by
  // first IP is the standard approach behind a trusted reverse proxy.
  function getClientIp(forwarded: string | undefined): string {
    if (!forwarded) return 'unknown';
    const first = forwarded.split(',')[0]?.trim();
    return first || 'unknown';
  }

  function checkRateLimit(
    map: Map<string, { count: number; resetAt: number }>,
    ip: string,
    max: number,
    now: number,
  ): boolean {
    const entry = map.get(ip);
    if (entry && entry.resetAt > now) {
      if (entry.count >= max) return false;
      entry.count++;
    } else {
      map.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    }
    return true;
  }

  function evictExpired(now: number) {
    for (const [key, val] of rateLimits) {
      if (val.resetAt <= now) rateLimits.delete(key);
    }
    for (const [key, val] of strictRateLimits) {
      if (val.resetAt <= now) strictRateLimits.delete(key);
    }
  }

  app.use('*', async (c, next) => {
    const ip = getClientIp(c.req.header('x-forwarded-for'));
    const now = Date.now();

    // Periodic cleanup
    requestCounter++;
    if (requestCounter % RATE_LIMIT_CLEANUP_INTERVAL === 0) {
      evictExpired(now);
    }

    if (!checkRateLimit(rateLimits, ip, RATE_LIMIT_MAX, now)) {
      log.warn(`Rate limit hit: ${ip} on ${c.req.path}`);
      return c.json({ error: 'Rate limit exceeded' }, 429);
    }
    await next();
  });

  // Routes
  app.get('/health', (c) => c.json({ status: 'ok' }));
  app.route('/', priceRoutes(pricing));
  app.route('/', txRoutes(db));
  app.route('/', statsRoutes(db, pricing));
  app.route('/', feedbackRoutes(feedbackDb));

  if (deps?.treasury) {
    // Stricter rate limit for state-changing endpoints
    const strictPrefixes = ['/buy', '/sell'];
    app.use('*', async (c, next) => {
      if (!strictPrefixes.some((p) => c.req.path === p || c.req.path.startsWith(p + '/'))) return next();
      const ip = getClientIp(c.req.header('x-forwarded-for'));
      const now = Date.now();
      if (!checkRateLimit(strictRateLimits, ip, RATE_LIMIT_STRICT_MAX, now)) {
        log.warn(`Strict rate limit hit: ${ip} on ${c.req.path}`);
        return c.json({ error: 'Rate limit exceeded' }, 429);
      }
      await next();
    });

    app.route('/', treasuryRoutes(deps.treasury, deps.payout, db));
    app.route('/', buyRoutes({ db, pricing, treasury: deps.treasury, payoutAddress: deps.payout?.walletAddress ?? '' }));
    app.route('/', sellRoutes({ db, pricing, treasuryAddress: deps.treasury.address, payout: deps.payout }));
  }

  return { app, db, pricing, feedbackDb };
}
