import { describe, it, expect, vi } from 'vitest';
import { X402Service } from './x402.js';

describe('X402Service', () => {
  const mockFacilitator = {
    verify: vi.fn(),
  };

  const service = new X402Service({
    facilitator: mockFacilitator as any,
    payTo: 'TreasuryMainnetAddress',
    network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  });

  it('creates 402 response payload', () => {
    const payload = service.createPaymentRequired(10.5, 'Buy 10 SOL devnet');
    expect(payload.x402Version).toBe(2);
    expect(payload.accepts).toHaveLength(1);
    expect(payload.accepts[0].price).toBe('$10.5');
    expect(payload.accepts[0].scheme).toBe('exact');
    expect(payload.accepts[0].network).toBe('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp');
  });

  it('verifies a valid payment', async () => {
    mockFacilitator.verify.mockResolvedValue({ valid: true });
    const result = await service.verifyPayment('payment-proof-header', 10.5);
    expect(result.valid).toBe(true);
  });

  it('rejects an invalid payment', async () => {
    mockFacilitator.verify.mockResolvedValue({ valid: false, reason: 'insufficient' });
    const result = await service.verifyPayment('bad-proof', 10.5);
    expect(result.valid).toBe(false);
  });
});
