import { BulkUpdateResult, computeResolvedAt, Feedback, FeedbackAdapter, FeedbackInput, FeedbackStatus, FeedbackUpdate } from '../types';

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

  function applyUpdate(existing: Feedback, updates: FeedbackUpdate): Feedback {
    const resolvedAt = computeResolvedAt(updates.status, existing.resolvedAt);
    return {
      ...existing,
      ...(updates.status !== undefined ? { status: updates.status } : {}),
      ...(updates.adminNotes !== undefined ? { adminNotes: updates.adminNotes } : {}),
      ...(updates.category !== undefined ? { category: updates.category } : {}),
      ...(resolvedAt !== undefined ? { resolvedAt: resolvedAt ?? undefined } : {}),
      updatedAt: new Date().toISOString(),
    };
  }

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
        category: input.category,
        createdAt: now,
        updatedAt: now,
      };

      storage.set(id, feedback);
      return feedback;
    },

    async update(id: string, updates: FeedbackUpdate): Promise<Feedback | null> {
      const existing = storage.get(id);
      if (!existing) return null;

      const updated = applyUpdate(existing, updates);
      storage.set(id, updated);
      return updated;
    },

    async delete(id: string): Promise<boolean> {
      return storage.delete(id);
    },

    async getCount(status?: FeedbackStatus): Promise<number> {
      if (!status) return storage.size;
      return Array.from(storage.values()).filter(f => f.status === status).length;
    },

    async bulkUpdate(updates: Array<{ id: string } & FeedbackUpdate>): Promise<BulkUpdateResult> {
      const results: Feedback[] = [];

      for (const { id, ...update } of updates) {
        const existing = storage.get(id);
        if (!existing) continue; // missing row — caller diffs to find it

        const updated = applyUpdate(existing, update);
        storage.set(id, updated);
        results.push(updated);
      }

      // The in-memory store never errors per item, so `failed` is always empty.
      return { updated: results, failed: [] };
    }
  };
}
