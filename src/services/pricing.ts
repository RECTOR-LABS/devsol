export interface Quote {
  sol_amount: number;
  usdc_amount: number;
  rate: number;
}

export interface PriceSummary {
  buy: { sol_per_usdc: number; usdc_per_sol: number };
  sell: { sol_per_usdc: number; usdc_per_sol: number };
  spread: number;
}

export class PricingService {
  constructor(
    private buyRate: number,
    private sellRate: number,
  ) {}

  buyQuote(solAmount: number): Quote {
    if (solAmount <= 0) throw new Error('Amount must be positive');
    return {
      sol_amount: solAmount,
      usdc_amount: this.round(solAmount * this.buyRate),
      rate: this.buyRate,
    };
  }

  sellQuote(solAmount: number): Quote {
    if (solAmount <= 0) throw new Error('Amount must be positive');
    return {
      sol_amount: solAmount,
      usdc_amount: this.round(solAmount * this.sellRate),
      rate: this.sellRate,
    };
  }

  summary(): PriceSummary {
    return {
      buy: { sol_per_usdc: this.round(1 / this.buyRate), usdc_per_sol: this.buyRate },
      sell: { sol_per_usdc: this.round(1 / this.sellRate), usdc_per_sol: this.sellRate },
      spread: this.round(this.buyRate - this.sellRate),
    };
  }

  private round(n: number): number {
    return Math.round(n * 1_000_000) / 1_000_000;
  }
}
