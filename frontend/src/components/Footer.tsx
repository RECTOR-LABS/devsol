export function Footer() {
  return (
    <footer className="w-full py-8 mt-12">
      <div className="max-w-[960px] mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-text-muted text-xs">
        <span>DevSOL — Devnet SOL Marketplace</span>
        <div className="flex gap-4">
          <a href="https://github.com/RECTOR-LABS/devsol" target="_blank" rel="noopener noreferrer" className="hover:text-text-secondary transition-colors">GitHub</a>
          <a href="/skill.md" target="_blank" rel="noopener noreferrer" className="hover:text-text-secondary transition-colors">AI Agents</a>
        </div>
      </div>
    </footer>
  );
}
