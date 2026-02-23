import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createApp } from '../app.js';
import { FeedbackDB } from '../db/feedback.js';

describe('Feedback routes', () => {
  let feedbackDb: FeedbackDB;
  let app: ReturnType<typeof createApp>['app'];

  beforeEach(() => {
    feedbackDb = new FeedbackDB(':memory:');
    const result = createApp({ feedbackDb });
    app = result.app;
  });
  afterEach(() => feedbackDb.close());

  it('GET /feedback returns empty list initially', async () => {
    const res = await app.request('/feedback');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.feedback).toEqual([]);
  });

  it('POST /feedback creates feedback', async () => {
    const res = await app.request('/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Add SOL/USDC chart please' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeDefined();
    expect(body.content).toBe('Add SOL/USDC chart please');
    expect(body.votes).toBe(0);
  });

  it('POST /feedback accepts optional author', async () => {
    const res = await app.request('/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Feature request with author', author: 'rector' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.author).toBe('rector');
  });

  it('POST /feedback validates content length (too short)', async () => {
    const res = await app.request('/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'short' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/10-500 characters/);
  });

  it('POST /feedback validates content length (too long)', async () => {
    const res = await app.request('/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'x'.repeat(501) }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /feedback rejects missing content', async () => {
    const res = await app.request('/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Content is required');
  });

  it('POST /feedback rejects invalid JSON', async () => {
    const res = await app.request('/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });

  it('POST /feedback/:id/vote upvotes feedback', async () => {
    const create = await app.request('/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Add price alerts feature' }),
    });
    const { id } = await create.json();

    const vote = await app.request(`/feedback/${id}/vote`, { method: 'POST' });
    expect(vote.status).toBe(200);
    const voteBody = await vote.json();
    expect(voteBody.ok).toBe(true);

    const list = await app.request('/feedback');
    const body = await list.json();
    expect(body.feedback[0].votes).toBe(1);
  });

  it('POST /feedback/:id/vote prevents duplicate votes from same IP', async () => {
    const create = await app.request('/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Duplicate vote test feedback' }),
    });
    const { id } = await create.json();

    await app.request(`/feedback/${id}/vote`, { method: 'POST' });
    const dup = await app.request(`/feedback/${id}/vote`, { method: 'POST' });
    expect(dup.status).toBe(409);
    const body = await dup.json();
    expect(body.error).toBe('Already voted');
  });

  it('GET /feedback returns sorted by votes descending', async () => {
    await app.request('/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Feature with fewer votes' }),
    });
    const r2 = await app.request('/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '2.2.2.2' },
      body: JSON.stringify({ content: 'Feature with more votes' }),
    });
    const { id: id2 } = await r2.json();
    await app.request(`/feedback/${id2}/vote`, { method: 'POST' });

    const list = await app.request('/feedback');
    const body = await list.json();
    expect(body.feedback[0].content).toBe('Feature with more votes');
    expect(body.feedback[0].votes).toBe(1);
    expect(body.feedback[1].content).toBe('Feature with fewer votes');
    expect(body.feedback[1].votes).toBe(0);
  });

  it('POST /feedback rate limits by IP (max 3 per hour)', async () => {
    const headers = { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.0.0.1' };
    for (let i = 0; i < 3; i++) {
      const res = await app.request('/feedback', {
        method: 'POST',
        headers,
        body: JSON.stringify({ content: `Feedback number ${i + 1} here` }),
      });
      expect(res.status).toBe(201);
    }

    const res = await app.request('/feedback', {
      method: 'POST',
      headers,
      body: JSON.stringify({ content: 'This should be rate limited' }),
    });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toMatch(/Too many posts/);
  });
});
