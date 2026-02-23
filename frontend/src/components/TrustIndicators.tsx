import type { PlatformStats } from '../types';

const TREASURY_WALLET = 'DSoLGdEsUxqx6a1LyUBdMq5sK8CXaoMVe19rFY34PoAt';
const PAYOUT_WALLET = 'Pay85GnSFPGf5tf72ae96pyYsN34fJzJm3G7CHHiHjx';
const GITHUB_URL = 'https://github.com/RECTOR-LABS/devsol';

function truncateWallet(address: string): string {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

interface TrustIndicatorsProps {
  stats: PlatformStats | null;
}

export function TrustIndicators({ stats }: TrustIndicatorsProps) {
  return (
    <div className="w-full">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-text-primary">Platform Transparency</h2>
        <p className="text-sm text-text-secondary">Full visibility into our operations</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ProofOfReserves />
        <Performance stats={stats} />
        <FeeTransparency stats={stats} />
        <OpenSource />
      </div>
    </div>
  );
}

function ProofOfReserves() {
  return (
    <div className="bg-card-bg border border-card-border rounded-[12px] p-5">
      <h3 className="text-text-primary font-semibold text-sm mb-3">Proof of Reserves</h3>
      <p className="text-text-secondary text-xs mb-3">Verify our wallets on Solscan</p>
      <div className="flex flex-col gap-2">
        <div className="flex justify-between items-center py-1.5">
          <span className="text-text-secondary text-sm">Treasury (Devnet)</span>
          <a
            href={`https://solscan.io/account/${TREASURY_WALLET}?cluster=devnet`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline text-sm"
          >
            {truncateWallet(TREASURY_WALLET)}
          </a>
        </div>
        <div className="flex justify-between items-center py-1.5">
          <span className="text-text-secondary text-sm">Payout (Mainnet)</span>
          <a
            href={`https://solscan.io/account/${PAYOUT_WALLET}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline text-sm"
          >
            {truncateWallet(PAYOUT_WALLET)}
          </a>
        </div>
      </div>
    </div>
  );
}

function Performance({ stats }: { stats: PlatformStats | null }) {
  const successRate = stats?.success_rate ?? 0;
  const rateColor = successRate > 95 ? 'text-accent' : 'text-text-primary';

  return (
    <div className="bg-card-bg border border-card-border rounded-[12px] p-5">
      <h3 className="text-text-primary font-semibold text-sm mb-3">Performance</h3>
      <div className="flex flex-col gap-0.5">
        <div className="flex justify-between items-center py-1.5">
          <span className="text-text-secondary text-sm">Success Rate</span>
          <span className={`text-sm font-medium ${rateColor}`}>{successRate}%</span>
        </div>
        <div className="flex justify-between items-center py-1.5">
          <span className="text-text-secondary text-sm">Avg Fulfillment</span>
          <span className="text-text-primary text-sm font-medium">~2 min</span>
        </div>
        <div className="flex justify-between items-center py-1.5">
          <span className="text-text-secondary text-sm">Uptime</span>
          <span className="text-text-primary text-sm font-medium">99.9%</span>
        </div>
      </div>
    </div>
  );
}

function FeeTransparency({ stats }: { stats: PlatformStats | null }) {
  return (
    <div className="bg-card-bg border border-card-border rounded-[12px] p-5">
      <h3 className="text-text-primary font-semibold text-sm mb-3">Fee Transparency</h3>
      <div className="flex flex-col gap-0.5">
        <div className="flex justify-between items-center py-1.5">
          <span className="text-text-secondary text-sm">Buy Rate</span>
          <span className="text-text-primary text-sm font-medium">
            {stats ? `${stats.buy_rate} USDC/SOL` : '—'}
          </span>
        </div>
        <div className="flex justify-between items-center py-1.5">
          <span className="text-text-secondary text-sm">Sell Rate</span>
          <span className="text-text-primary text-sm font-medium">
            {stats ? `${stats.sell_rate} USDC/SOL` : '—'}
          </span>
        </div>
        <div className="flex justify-between items-center py-1.5">
          <span className="text-text-secondary text-sm">Spread</span>
          <span className="text-text-primary text-sm font-medium">
            {stats ? `${stats.spread}%` : '—'}
          </span>
        </div>
      </div>
      <p className="text-text-muted text-xs mt-3">Network fees included — we cover gas</p>
    </div>
  );
}

function OpenSource() {
  return (
    <div className="bg-card-bg border border-card-border rounded-[12px] p-5">
      <h3 className="text-text-primary font-semibold text-sm mb-3">Open Source</h3>
      <p className="text-text-secondary text-sm mb-4">Fully auditable code</p>
      <a
        href={GITHUB_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary hover:underline text-sm font-medium"
      >
        Star on GitHub ↗
      </a>
    </div>
  );
}
