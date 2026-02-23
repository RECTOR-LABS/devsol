import { useState, useEffect } from 'react';
import { api } from '../api';
import type { PlatformStats, HealthDetail } from '../types';

export function useStats() {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [health, setHealth] = useState<HealthDetail | null>(null);

  useEffect(() => {
    const load = () => {
      api.getStats().then(setStats).catch(console.error);
      api.getHealthDetail().then(setHealth).catch(console.error);
    };
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, []);

  return { stats, health };
}
