interface X402Config {
  facilitator: { verify: (proof: string, opts: any) => Promise<{ valid: boolean; reason?: string }> };
  payTo: string;
  network: string;
}

interface PaymentRequiredPayload {
  x402Version: number;
  accepts: Array<{
    scheme: string;
    price: string;
    network: string;
    payTo: string;
  }>;
  description: string;
}

interface VerifyResult {
  valid: boolean;
  reason?: string;
}

export class X402Service {
  constructor(private cfg: X402Config) {}

  createPaymentRequired(usdcAmount: number, description: string): PaymentRequiredPayload {
    return {
      x402Version: 2,
      accepts: [
        {
          scheme: 'exact',
          price: `$${usdcAmount}`,
          network: this.cfg.network,
          payTo: this.cfg.payTo,
        },
      ],
      description,
    };
  }

  async verifyPayment(paymentHeader: string, expectedUsdc: number): Promise<VerifyResult> {
    return this.cfg.facilitator.verify(paymentHeader, {
      price: `$${expectedUsdc}`,
      network: this.cfg.network,
      payTo: this.cfg.payTo,
    });
  }
}
