import { Hono } from 'hono';
import type { TransactionDB } from '../db/sqlite.js';

export function txRoutes(db: TransactionDB) {
  const router = new Hono();
  router.get('/tx/:id', (c) => {
    const tx = db.getById(c.req.param('id'));
    if (!tx) return c.json({ error: 'Transaction not found' }, 404);
    return c.json(tx);
  });
  return router;
}
