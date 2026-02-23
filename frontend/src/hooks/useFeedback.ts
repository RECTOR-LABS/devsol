import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import type { Feedback } from '../types';

export function useFeedback() {
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { feedback } = await api.getFeedback();
      setFeedback(feedback);
    } catch {
      // silent — non-critical feature
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const submit = async (content: string, author?: string) => {
    const fb = await api.postFeedback(content, author);
    setFeedback((prev) => [fb, ...prev].sort((a, b) => b.votes - a.votes));
    return fb;
  };

  const vote = async (id: string) => {
    await api.voteFeedback(id);
    setFeedback((prev) =>
      prev.map((f) => (f.id === id ? { ...f, votes: f.votes + 1 } : f))
        .sort((a, b) => b.votes - a.votes)
    );
  };

  return { feedback, loading, submit, vote, refresh };
}
