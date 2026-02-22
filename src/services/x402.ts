import {
  encodePaymentRequiredHeader,
  decodePaymentSignatureHeader,
  encodePaymentResponseHeader,
} from '@x402/core/http';
import type {
  FacilitatorClient,
} from '@x402/core/http';
import type {
  PaymentRequired,
  PaymentRequirements,
  PaymentPayload,
  VerifyResponse,
  SettleResponse,
} from '@x402/core/types';
import { USDC_MAINNET_ADDRESS, convertToTokenAmount } from '@x402/svm';

const USDC_DECIMALS = 6;
const MAX_TIMEOUT_SECONDS = 300;

export interface X402Config {
  facilitator: FacilitatorClient;
  payTo: string;
  network: string;
}

export class X402Service {
  constructor(private cfg: X402Config) {}

  /** Create PaymentRequirements for a given USDC amount */
  createPaymentRequirements(usdcAmount: number): PaymentRequirements {
    return {
      scheme: 'exact',
      network: this.cfg.network as `${string}:${string}`,
      asset: USDC_MAINNET_ADDRESS,
      amount: convertToTokenAmount(usdcAmount.toString(), USDC_DECIMALS),
      payTo: this.cfg.payTo,
      maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
      extra: {},
    };
  }

  /** Create full 402 PaymentRequired response payload */
  createPaymentRequired(usdcAmount: number, description: string): PaymentRequired {
    return {
      x402Version: 2,
      resource: {
        url: '/buy',
        description,
        mimeType: 'application/json',
      },
      accepts: [this.createPaymentRequirements(usdcAmount)],
    };
  }

  /** Encode PaymentRequired as base64 for X-PAYMENT-REQUIRED header */
  encodePaymentRequiredHeader(payload: PaymentRequired): string {
    return encodePaymentRequiredHeader(payload);
  }

  /** Decode incoming X-PAYMENT header to PaymentPayload */
  decodePaymentSignatureHeader(header: string): PaymentPayload {
    return decodePaymentSignatureHeader(header);
  }

  /** Verify a payment via facilitator */
  async verifyPayment(paymentHeader: string, usdcAmount: number): Promise<VerifyResponse> {
    const paymentPayload = this.decodePaymentSignatureHeader(paymentHeader);
    const requirements = this.createPaymentRequirements(usdcAmount);
    return this.cfg.facilitator.verify(paymentPayload, requirements);
  }

  /** Settle a payment via facilitator (call async after delivery) */
  async settlePayment(paymentHeader: string, usdcAmount: number): Promise<SettleResponse> {
    const paymentPayload = this.decodePaymentSignatureHeader(paymentHeader);
    const requirements = this.createPaymentRequirements(usdcAmount);
    return this.cfg.facilitator.settle(paymentPayload, requirements);
  }

  /** Encode settle response for X-PAYMENT-RESPONSE header */
  encodePaymentResponseHeader(settleResponse: SettleResponse): string {
    return encodePaymentResponseHeader(settleResponse);
  }
}
