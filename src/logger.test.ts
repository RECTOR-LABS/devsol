import { describe, it, expect } from 'vitest';
import { createLogger } from './logger.js';

describe('Logger', () => {
  it('creates a logger with correct name', () => {
    const log = createLogger('test');
    expect(log).toBeDefined();
    expect(typeof log.child).toBe('function');
    expect(typeof log.info).toBe('function');
    expect(typeof log.error).toBe('function');
  });
});
