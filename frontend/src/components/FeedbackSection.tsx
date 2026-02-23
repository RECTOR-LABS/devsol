import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useFeedback } from '../hooks/useFeedback';

export function FeedbackSection() {
  const { feedback, loading, submit, vote } = useFeedback();
  const { publicKey } = useWallet();
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [votedIds, setVotedIds] = useState<Set<string>>(new Set());

  const walletLabel = publicKey
    ? `${publicKey.toBase58().slice(0, 4)}...${publicKey.toBase58().slice(-4)}`
    : null;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (content.trim().length < 10) {
      setError('Feedback must be at least 10 characters');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await submit(content.trim(), walletLabel ?? undefined);
      setContent('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVote(id: string) {
    if (votedIds.has(id)) return;
    try {
      await vote(id);
      setVotedIds((prev) => new Set(prev).add(id));
    } catch {
      // already voted or rate limited — ignore
    }
  }

  function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr + 'Z').getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  return (
    <div className="bg-card-bg border border-card-border rounded-[12px] h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-card-border">
        <span className="text-sm font-semibold text-text-primary">Feedback</span>
      </div>

      {/* Submit form */}
      <form onSubmit={handleSubmit} className="px-4 py-3 border-b border-card-border">
        <div className="flex gap-2">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Suggest a feature or improvement..."
            maxLength={500}
            rows={2}
            className="flex-1 bg-input-bg border border-input-border rounded-sm px-3 py-2 text-sm text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:border-primary"
          />
          <button
            type="submit"
            disabled={submitting || content.trim().length < 10}
            className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-sm hover:opacity-90 disabled:opacity-40 transition-opacity self-end"
          >
            {submitting ? '...' : 'Post'}
          </button>
        </div>
        {walletLabel && (
          <p className="text-xs text-text-muted mt-1">Posting as {walletLabel}</p>
        )}
        {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
      </form>

      {/* Feedback list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <p className="text-text-muted text-sm py-8 text-center">Loading...</p>
        ) : feedback.length === 0 ? (
          <p className="text-text-muted text-sm py-8 text-center">
            No feedback yet. Be the first!
          </p>
        ) : (
          feedback.map((fb) => (
            <div
              key={fb.id}
              className="px-4 py-3 border-b border-card-border last:border-0 flex items-start gap-3"
            >
              <button
                onClick={() => handleVote(fb.id)}
                disabled={votedIds.has(fb.id)}
                className={`flex flex-col items-center min-w-[32px] pt-0.5 transition-colors ${
                  votedIds.has(fb.id) ? 'text-primary' : 'text-text-muted hover:text-primary'
                }`}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 4L3 10h10L8 4z" />
                </svg>
                <span className="text-xs font-medium">{fb.votes}</span>
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-text-primary">{fb.content}</p>
                <p className="text-xs text-text-muted mt-1">
                  {fb.author ?? 'Anonymous'} &middot; {timeAgo(fb.created_at)}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
