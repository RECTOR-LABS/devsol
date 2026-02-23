import { Hono } from 'hono';
import { createHash } from 'crypto';
import type { FeedbackDB } from '../db/feedback.js';
import { createLogger } from '../logger.js';

const log = createLogger('feedback');

const MIN_CONTENT = 1;
const MAX_CONTENT = 500;
const MAX_POSTS_PER_HOUR = 3;
const MAX_VOTES_PER_HOUR = 10;

function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex').slice(0, 16);
}

export function feedbackRoutes(db: FeedbackDB) {
  const router = new Hono();

  router.get('/feedback', (c) => {
    const feedback = db.listAll();
    return c.json({ feedback });
  });

  router.post('/feedback', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.content !== 'string') {
      return c.json({ error: 'Content is required' }, 400);
    }

    const content = body.content.trim();
    if (content.length < MIN_CONTENT || content.length > MAX_CONTENT) {
      return c.json({ error: `Content must be ${MIN_CONTENT}-${MAX_CONTENT} characters` }, 400);
    }

    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const ipHash = hashIp(ip);

    if (db.countByIp(ipHash) >= MAX_POSTS_PER_HOUR) {
      log.warn(`Feedback rate limit: ${ipHash}`);
      return c.json({ error: 'Too many posts. Try again later.' }, 429);
    }

    const author = typeof body.author === 'string' && body.author.trim()
      ? body.author.trim()
      : undefined;
    const feedback = db.create({ content, author, ipHash });
    return c.json(feedback, 201);
  });

  router.post('/feedback/:id/vote', (c) => {
    const { id } = c.req.param();
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const ipHash = hashIp(ip);

    if (db.countVotesByIp(ipHash) >= MAX_VOTES_PER_HOUR) {
      return c.json({ error: 'Too many votes. Try again later.' }, 429);
    }

    const ok = db.vote(id, ipHash);
    if (!ok) {
      return c.json({ error: 'Already voted' }, 409);
    }
    return c.json({ ok: true });
  });

  return router;
}
