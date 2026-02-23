import type {
  BuyResponse,
  SellResponse,
  PriceSummary,
  PlatformStats,
  HealthDetail,
  Transaction,
  RecentTransaction,
} from './types';

const BASE = import.meta.env.VITE_API_URL || '/api';

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  getPrice: () => fetchJson<PriceSummary>('/price'),
  getStats: () => fetchJson<PlatformStats>('/stats'),
  getHealthDetail: () => fetchJson<HealthDetail>('/health/detail'),
  getRecentTx: () =>
    fetchJson<{ transactions: RecentTransaction[] }>('/tx/recent'),
  getTx: (id: string) => fetchJson<Transaction>(`/tx/${id}`),
  buy: (wallet: string, amount_sol: number) =>
    fetchJson<BuyResponse>('/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet, amount_sol }),
    }),
  sell: (wallet: string, amount_sol: number) =>
    fetchJson<SellResponse>('/sell', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet, amount_sol }),
    }),
};
