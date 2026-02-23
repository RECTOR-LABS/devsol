import { useState, useEffect } from 'react';
import { api } from '../api';
import type { RecentTransaction } from '../types';

export function useRecentTx() {
  const [transactions, setTransactions] = useState<RecentTransaction[]>([]);

  useEffect(() => {
    const load = () =>
      api
        .getRecentTx()
        .then((r) => setTransactions(r.transactions))
        .catch(console.error);
    load();
    const interval = setInterval(load, 15_000);
    return () => clearInterval(interval);
  }, []);

  return transactions;
}
