import { Widget } from './components/Widget';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { TreasuryStats } from './components/TreasuryStats';
import { TrustIndicators } from './components/TrustIndicators';
import { TxFeed } from './components/TxFeed';
import { useStats } from './hooks/useStats';
import { useRecentTx } from './hooks/useRecentTx';

export default function App() {
  const { stats, health } = useStats();
  const transactions = useRecentTx();

  return (
    <div className="min-h-screen bg-bg text-text-primary font-sans">
      <Header />

      <main className="max-w-[960px] mx-auto px-4 space-y-8">
        {/* Treasury Stats Bar */}
        <TreasuryStats stats={stats} health={health} />

        {/* Trust Indicators */}
        <TrustIndicators stats={stats} />

        {/* Widget + Feed side by side */}
        <div className="flex flex-col lg:flex-row gap-6">
          <div className="w-full lg:w-[420px] shrink-0">
            <Widget />
          </div>
          <div className="flex-1 min-w-0">
            <TxFeed transactions={transactions} />
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
