export interface Transaction {
  id: string;
  type: 'buy' | 'sell';
  wallet: string;
  sol_amount: number;
  usdc_amount: number;
  status: 'pending' | 'completed' | 'failed' | 'refunded' | 'expired';
  created_at: string;
  memo?: string;
  mainnet_tx?: string;
  devnet_tx?: string;
}

export interface BuyResponse {
  transaction_id: string;
  status: string;
  deposit_address: string;
  memo: string;
  amount_sol: number;
  usdc_cost: number;
  instructions: string;
}

export interface SellResponse {
  transaction_id: string;
  status: string;
  deposit_address: string;
  memo: string;
  amount_sol: number;
  usdc_payout: number;
  instructions: string;
}

export interface PriceSummary {
  buy: { sol_per_usdc: number; usdc_per_sol: number };
  sell: { sol_per_usdc: number; usdc_per_sol: number };
  spread: number;
}

export interface PlatformStats {
  total_trades: number;
  completed_trades: number;
  pending_orders: number;
  success_rate: number;
  buy_rate: number;
  sell_rate: number;
  spread: number;
  network_fees: string;
}

export interface HealthDetail {
  treasury_sol: number | null;
  payout_usdc: number | null;
  payout_wallet: string | null;
  pending_orders: number;
}

export interface RecentTransaction {
  id: string;
  type: string;
  wallet: string;
  sol_amount: number;
  usdc_amount: number;
  status: string;
  created_at: string;
}
