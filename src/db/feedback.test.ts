import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FeedbackDB } from './feedback.js';

describe('FeedbackDB', () => {
  let db: FeedbackDB;

  beforeEach(() => { db = new FeedbackDB(':memory:'); });
  afterEach(() => { db.close(); });

  it('creates feedback and retrieves it', () => {
    const fb = db.create({ content: 'Add dark mode toggle', author: 'DSoL...PoAt', ipHash: 'abc123' });
    expect(fb.id).toBeDefined();
    expect(fb.content).toBe('Add dark mode toggle');
    expect(fb.votes).toBe(0);

    const all = db.listAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(fb.id);
  });

  it('returns feedback sorted by votes descending', () => {
    const fb1 = db.create({ content: 'Feature A', ipHash: 'ip1' });
    const fb2 = db.create({ content: 'Feature B', ipHash: 'ip2' });
    db.vote(fb2.id, 'voter1');
    db.vote(fb2.id, 'voter2');
    db.vote(fb1.id, 'voter3');

    const all = db.listAll();
    expect(all[0].id).toBe(fb2.id);
    expect(all[0].votes).toBe(2);
    expect(all[1].votes).toBe(1);
  });

  it('prevents duplicate votes from same IP', () => {
    const fb = db.create({ content: 'Test', ipHash: 'ip1' });
    const first = db.vote(fb.id, 'same-ip');
    const second = db.vote(fb.id, 'same-ip');
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(db.listAll()[0].votes).toBe(1);
  });

  it('returns empty list when no feedback', () => {
    expect(db.listAll()).toEqual([]);
  });

  it('counts feedback by IP hash', () => {
    db.create({ content: 'First', ipHash: 'ip1' });
    db.create({ content: 'Second', ipHash: 'ip1' });
    db.create({ content: 'Third', ipHash: 'ip2' });
    expect(db.countByIp('ip1')).toBe(2);
    expect(db.countByIp('ip2')).toBe(1);
  });

  it('counts votes by IP hash', () => {
    const fb1 = db.create({ content: 'A', ipHash: 'ip1' });
    const fb2 = db.create({ content: 'B', ipHash: 'ip1' });
    db.vote(fb1.id, 'voter-ip');
    db.vote(fb2.id, 'voter-ip');
    expect(db.countVotesByIp('voter-ip')).toBe(2);
  });
});
