import { Hono } from 'hono';
import { priceRoutes } from './routes/price.js';
import { treasuryRoutes } from './routes/treasury.js';
import { txRoutes } from './routes/tx.js';
import { PricingService } from './services/pricing.js';
import type { TreasuryService } from './services/treasury.js';
import { TransactionDB } from './db/sqlite.js';
import { config } from './config.js';

interface AppDeps {
  pricing?: PricingService;
  treasury?: TreasuryService;
  db?: TransactionDB;
}

export function createApp(deps?: AppDeps) {
  const pricing = deps?.pricing ?? new PricingService(config.buyPrice, config.sellPrice);
  const db = deps?.db ?? new TransactionDB(config.dbPath);

  const app = new Hono();
  app.get('/health', (c) => c.json({ status: 'ok' }));
  app.route('/', priceRoutes(pricing));
  app.route('/', txRoutes(db));

  if (deps?.treasury) {
    app.route('/', treasuryRoutes(deps.treasury));
  }

  return { app, db, pricing };
}
