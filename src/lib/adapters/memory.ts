import { Feedback, FeedbackAdapter, FeedbackInput, FeedbackStatus, FeedbackUpdate } from '../types';

/**
 * In-memory adapter for development and testing
 *
 * @example
 * ```ts
 * import { createMemoryAdapter } from 'contextual-feedback/adapters/memory';
 *
 * const adapter = createMemoryAdapter();
 * ```
 */
export function createMemoryAdapter(): FeedbackAdapter {
  const storage: Map<string, Feedback> = new Map();

  return {
    async getAll(status?: FeedbackStatus): Promise<Feedback[]> {
      const all = Array.from(storage.values());
      const filtered = status ? all.filter(f => f.status === status) : all;
      return filtered.sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    },

    async getById(id: string): Promise<Feedback | null> {
      return storage.get(id) || null;
    },

    async add(input: FeedbackInput): Promise<Feedback> {
      const id = `feedback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const now = new Date().toISOString();

      const feedback: Feedback = {
        id,
        userEmail: input.userEmail,
        pageUrl: input.pageUrl,
        feedbackText: input.feedbackText,
        status: 'Pending',
        context: input.context,
        elementId: input.elementId,
        createdAt: now,
        updatedAt: now,
      };

      storage.set(id, feedback);
      return feedback;
    },

    async update(id: string, updates: FeedbackUpdate): Promise<Feedback | null> {
      const existing = storage.get(id);
      if (!existing) return null;

      const updated: Feedback = {
        ...existing,
        ...updates,
        updatedAt: new Date().toISOString(),
      };

      storage.set(id, updated);
      return updated;
    },

    async delete(id: string): Promise<boolean> {
      return storage.delete(id);
    },

    async getCount(status?: FeedbackStatus): Promise<number> {
      if (!status) return storage.size;
      return Array.from(storage.values()).filter(f => f.status === status).length;
    }
  };
}
