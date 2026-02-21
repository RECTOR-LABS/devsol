import { describe, it, expect } from 'vitest';
import { validateBuySellBody } from './validation.js';

describe('validateBuySellBody', () => {
  const validWallet = 'BuyerWa11etAddressXXXXXXXXXXXXXXXXXXXXXXXX';

  it('accepts valid input', () => {
    const result = validateBuySellBody({ wallet: validWallet, amount_sol: 10 });
    expect(result).toEqual({ wallet: validWallet, amount_sol: 10 });
  });

  it('rejects missing body', () => {
    expect(typeof validateBuySellBody(null)).toBe('string');
    expect(typeof validateBuySellBody(undefined)).toBe('string');
  });

  it('rejects non-base58 wallet', () => {
    expect(typeof validateBuySellBody({ wallet: 'not-valid!@#', amount_sol: 10 })).toBe('string');
  });

  it('rejects too-short wallet', () => {
    expect(typeof validateBuySellBody({ wallet: 'abc', amount_sol: 10 })).toBe('string');
  });

  it('rejects non-string wallet', () => {
    expect(typeof validateBuySellBody({ wallet: 12345, amount_sol: 10 })).toBe('string');
  });

  it('rejects string amount_sol', () => {
    expect(typeof validateBuySellBody({ wallet: validWallet, amount_sol: '10' })).toBe('string');
  });

  it('rejects NaN amount_sol', () => {
    expect(typeof validateBuySellBody({ wallet: validWallet, amount_sol: NaN })).toBe('string');
  });

  it('rejects Infinity amount_sol', () => {
    expect(typeof validateBuySellBody({ wallet: validWallet, amount_sol: Infinity })).toBe('string');
  });

  it('rejects zero amount_sol', () => {
    expect(typeof validateBuySellBody({ wallet: validWallet, amount_sol: 0 })).toBe('string');
  });

  it('rejects negative amount_sol', () => {
    expect(typeof validateBuySellBody({ wallet: validWallet, amount_sol: -5 })).toBe('string');
  });

  it('rejects amount over max (1000 SOL)', () => {
    expect(typeof validateBuySellBody({ wallet: validWallet, amount_sol: 1001 })).toBe('string');
  });

  it('accepts amount at max boundary', () => {
    const result = validateBuySellBody({ wallet: validWallet, amount_sol: 1000 });
    expect(result).toEqual({ wallet: validWallet, amount_sol: 1000 });
  });
});
