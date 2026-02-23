import type { PlatformStats, HealthDetail } from '../types';

interface TreasuryStatsProps {
  stats: PlatformStats | null;
  health: HealthDetail | null;
}

export function TreasuryStats({ stats, health }: TreasuryStatsProps) {
  return (
    <div className="w-full bg-card-bg border border-card-border rounded-[12px] p-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        <StatItem
          label="Treasury SOL"
          value={health ? health.treasury_sol.toFixed(2) : '—'}
          unit="SOL (Devnet)"
        />
        <StatItem
          label="Payout Reserves"
          value={health ? health.payout_usdc.toFixed(2) : '—'}
          unit="USDC (Mainnet)"
        />
        <StatItem
          label="Total Trades"
          value={stats ? String(stats.total_trades) : '—'}
        />
        <StatItem
          label="Pending Orders"
          value={stats ? String(stats.pending_orders) : '—'}
        />
      </div>
    </div>
  );
}

function StatItem({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-text-muted uppercase tracking-wider">{label}</span>
      <span className="text-xl font-bold text-text-primary">{value}</span>
      {unit && <span className="text-sm text-text-secondary">{unit}</span>}
    </div>
  );
}
