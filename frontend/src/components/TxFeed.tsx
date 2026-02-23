import type { RecentTransaction } from '../types';

interface TxFeedProps {
  transactions: RecentTransaction[];
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr + 'Z').getTime();
  const sec = Math.floor((now - then) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

export function TxFeed({ transactions }: TxFeedProps) {
  return (
    <div className="bg-card-bg border border-card-border rounded-[12px] h-full flex flex-col">
      <div className="px-4 py-3 border-b border-card-border flex items-center justify-between">
        <span className="text-sm font-semibold text-text-primary">
          Recent Transactions
        </span>
        <span className="flex items-center">
          <span className="w-2 h-2 rounded-full bg-accent animate-pulse inline-block" />
          <span className="text-xs text-accent ml-1.5">Live</span>
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {transactions.length === 0 ? (
          <p className="text-text-muted text-sm py-8 text-center">
            No transactions yet
          </p>
        ) : (
          transactions.map((tx) => <TxRow key={tx.id} tx={tx} />)
        )}
      </div>
    </div>
  );
}

function TxRow({ tx }: { tx: RecentTransaction }) {
  const isBuy = tx.type === 'buy';
  const isPending = tx.status === 'pending';

  return (
    <div className="px-4 py-3 border-b border-card-border last:border-0 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${
            isBuy ? 'bg-primary/10 text-primary' : 'bg-accent/10 text-accent'
          }`}
        >
          {isBuy ? '↑' : '↓'}
        </div>
        <div className="flex flex-col">
          <span className="text-sm text-text-primary">{tx.wallet}</span>
          <span className="text-xs text-text-muted">
            {isBuy ? 'Buy' : 'Sell'}
          </span>
        </div>
      </div>

      <div className="flex flex-col items-end">
        {isPending ? (
          <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
            Pending
          </span>
        ) : (
          <span className="text-sm font-medium text-text-primary">
            {tx.sol_amount} SOL
          </span>
        )}
        <span className="text-xs text-text-muted">
          {timeAgo(tx.created_at)}
        </span>
      </div>
    </div>
  );
}
