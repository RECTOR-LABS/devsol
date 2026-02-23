import { Widget } from './components/Widget';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { TreasuryStats } from './components/TreasuryStats';
import { TrustIndicators } from './components/TrustIndicators';
import { FeedbackSection } from './components/FeedbackSection';
import { TxFeed } from './components/TxFeed';
import { useStats } from './hooks/useStats';
import { useRecentTx } from './hooks/useRecentTx';

export default function App() {
  const { stats, health } = useStats();
  const transactions = useRecentTx();

  return (
    <div className="min-h-screen bg-bg text-text-primary font-sans">
      <Header />

      {/* Hero: Widget centered with tagline */}
      <section className="py-12 sm:py-16">
        <div className="max-w-[960px] mx-auto px-4 flex flex-col items-center">
          <h1 className="text-3xl sm:text-4xl font-bold text-center mb-2">
            Buy & Sell <span className="text-primary">Devnet SOL</span>
          </h1>
          <p className="text-text-secondary text-center mb-8 max-w-md">
            Instant devnet SOL with mainnet USDC. No faucets, no waiting.
          </p>
          <Widget />
        </div>
      </section>

      {/* Live Feed + Stats */}
      <main className="max-w-[960px] mx-auto px-4 space-y-8 pb-8">
        {/* Treasury Stats Bar */}
        <TreasuryStats stats={stats} health={health} />

        {/* Recent Transactions */}
        <TxFeed transactions={transactions} />

        {/* Trust Indicators */}
        <TrustIndicators stats={stats} />

        {/* Feedback */}
        <FeedbackSection />
      </main>

      <Footer />
    </div>
  );
}
