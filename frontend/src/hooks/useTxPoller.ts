import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import type { Transaction } from '../types';

export function useTxPoller() {
  const [txId, setTxId] = useState<string | null>(null);
  const [tx, setTx] = useState<Transaction | null>(null);
  const [polling, setPolling] = useState(false);

  const startPolling = useCallback((id: string) => {
    setTxId(id);
    setTx(null);
    setPolling(true);
  }, []);

  const reset = useCallback(() => {
    setTxId(null);
    setTx(null);
    setPolling(false);
  }, []);

  useEffect(() => {
    if (!txId || !polling) return;
    let cancelled = false;

    const poll = async () => {
      while (!cancelled) {
        try {
          const result = await api.getTx(txId);
          if (cancelled) return;
          setTx(result);
          if (result.status !== 'pending') {
            setPolling(false);
            return;
          }
        } catch {
          // Continue polling on error — next iteration retries
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
    };

    poll();
    return () => {
      cancelled = true;
    };
  }, [txId, polling]);

  return { tx, polling, startPolling, reset };
}
