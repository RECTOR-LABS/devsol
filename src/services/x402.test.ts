import { describe, it, expect, vi } from 'vitest';
import { X402Service } from './x402.js';

describe('X402Service', () => {
  const mockFacilitator = {
    verify: vi.fn(),
    settle: vi.fn(),
    getSupported: vi.fn(),
  };

  const service = new X402Service({
    facilitator: mockFacilitator as any,
    payTo: 'TreasuryMainnetAddress',
    network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  });

  it('creates payment requirements for a given USDC amount', () => {
    const req = service.createPaymentRequirements(10.5);
    expect(req.scheme).toBe('exact');
    expect(req.network).toBe('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp');
    expect(req.payTo).toBe('TreasuryMainnetAddress');
    expect(req.amount).toBe('10500000');
    expect(req.asset).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    expect(req.maxTimeoutSeconds).toBe(300);
    expect(req.extra).toEqual({});
  });

  it('creates 402 payment required response', () => {
    const payload = service.createPaymentRequired(10.5, 'Buy 10 SOL devnet');
    expect(payload.x402Version).toBe(2);
    expect(payload.resource).toEqual({
      url: '/buy',
      description: 'Buy 10 SOL devnet',
      mimeType: 'application/json',
    });
    expect(payload.accepts).toHaveLength(1);
    expect(payload.accepts[0].scheme).toBe('exact');
    expect(payload.accepts[0].payTo).toBe('TreasuryMainnetAddress');
    expect(payload.accepts[0].amount).toBe('10500000');
  });

  it('encodes payment required as base64 header', () => {
    const payload = service.createPaymentRequired(10.5, 'Buy 10 SOL devnet');
    const encoded = service.encodePaymentRequiredHeader(payload);
    expect(typeof encoded).toBe('string');
    expect(encoded.length).toBeGreaterThan(0);
    // Should be valid base64
    expect(() => Buffer.from(encoded, 'base64')).not.toThrow();
  });

  it('decodes payment signature header', () => {
    const mockPayload = {
      x402Version: 2,
      resource: { url: '/buy', description: 'test', mimeType: 'application/json' },
      accepted: service.createPaymentRequirements(10.5),
      payload: { transaction: 'base64tx' },
    };
    const encoded = Buffer.from(JSON.stringify(mockPayload)).toString('base64');
    const decoded = service.decodePaymentSignatureHeader(encoded);
    expect(decoded.x402Version).toBe(2);
    expect(decoded.resource.url).toBe('/buy');
    expect(decoded.payload.transaction).toBe('base64tx');
  });

  it('verifies a payment via facilitator', async () => {
    mockFacilitator.verify.mockResolvedValue({ isValid: true });
    const mockPayload = {
      x402Version: 2,
      resource: { url: '/buy', description: 'test', mimeType: 'application/json' },
      accepted: service.createPaymentRequirements(10.5),
      payload: { transaction: 'base64tx' },
    };
    const encodedPayment = Buffer.from(JSON.stringify(mockPayload)).toString('base64');

    const result = await service.verifyPayment(encodedPayment, 10.5);
    expect(result.isValid).toBe(true);
    expect(mockFacilitator.verify).toHaveBeenCalledWith(
      expect.objectContaining({ x402Version: 2 }),
      expect.objectContaining({ scheme: 'exact', amount: '10500000' }),
    );
  });

  it('rejects an invalid payment via facilitator', async () => {
    mockFacilitator.verify.mockResolvedValue({ isValid: false, invalidReason: 'insufficient funds' });
    const mockPayload = {
      x402Version: 2,
      resource: { url: '/buy', description: 'test', mimeType: 'application/json' },
      accepted: service.createPaymentRequirements(10.5),
      payload: { transaction: 'base64tx' },
    };
    const encodedPayment = Buffer.from(JSON.stringify(mockPayload)).toString('base64');

    const result = await service.verifyPayment(encodedPayment, 10.5);
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe('insufficient funds');
  });

  it('settles a payment via facilitator', async () => {
    mockFacilitator.settle.mockResolvedValue({
      success: true,
      transaction: 'tx123',
      network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    });
    const mockPayload = {
      x402Version: 2,
      resource: { url: '/buy', description: 'test', mimeType: 'application/json' },
      accepted: service.createPaymentRequirements(10.5),
      payload: { transaction: 'base64tx' },
    };
    const encodedPayment = Buffer.from(JSON.stringify(mockPayload)).toString('base64');

    const result = await service.settlePayment(encodedPayment, 10.5);
    expect(result.success).toBe(true);
    expect(result.transaction).toBe('tx123');
    expect(mockFacilitator.settle).toHaveBeenCalledWith(
      expect.objectContaining({ x402Version: 2 }),
      expect.objectContaining({ scheme: 'exact', amount: '10500000' }),
    );
  });

  it('encodes settle response as header', () => {
    const settleResponse = {
      success: true,
      transaction: 'tx123',
      network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const,
    };
    const encoded = service.encodePaymentResponseHeader(settleResponse);
    expect(typeof encoded).toBe('string');
    expect(encoded.length).toBeGreaterThan(0);
  });
});
