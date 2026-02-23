import { useState, useEffect } from 'react';
import { api } from '../api';
import type { PriceSummary } from '../types';

export function useQuote() {
  const [prices, setPrices] = useState<PriceSummary | null>(null);

  useEffect(() => {
    api.getPrice().then(setPrices).catch(console.error);
    const interval = setInterval(() => {
      api.getPrice().then(setPrices).catch(console.error);
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  function getBuyQuote(solAmount: number) {
    if (!prices || solAmount <= 0) return null;
    return {
      sol: solAmount,
      usdc: Math.round(solAmount * prices.buy.usdc_per_sol * 1_000_000) / 1_000_000,
    };
  }

  function getSellQuote(solAmount: number) {
    if (!prices || solAmount <= 0) return null;
    return {
      sol: solAmount,
      usdc: Math.round(solAmount * prices.sell.usdc_per_sol * 1_000_000) / 1_000_000,
    };
  }

  return { prices, getBuyQuote, getSellQuote };
}
