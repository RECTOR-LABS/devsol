export function Header() {
  return (
    <header className="w-full py-6">
      <div className="max-w-[960px] mx-auto px-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src="/devsol-logo.svg" alt="DevSOL" className="w-8 h-8" />
          <span className="text-2xl font-bold text-text-primary">DevSOL</span>
          <span className="text-sm text-text-secondary hidden sm:inline">Devnet SOL Marketplace</span>
        </div>
        <a
          href="https://github.com/RECTOR-LABS/devsol"
          target="_blank"
          rel="noopener noreferrer"
          className="text-text-muted hover:text-text-secondary text-sm transition-colors"
        >
          GitHub ↗
        </a>
      </div>
    </header>
  );
}
