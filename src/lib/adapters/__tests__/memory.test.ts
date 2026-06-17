import { describe, it, expect, beforeEach } from 'vitest';
import { createMemoryAdapter } from '../memory';
import { FeedbackAdapter } from '../../types';

describe('createMemoryAdapter', () => {
  let adapter: FeedbackAdapter;

  beforeEach(() => {
    adapter = createMemoryAdapter();
  });

  it('starts empty', async () => {
    const all = await adapter.getAll();
    expect(all).toEqual([]);
  });

  it('adds feedback and returns it with generated id', async () => {
    const result = await adapter.add({
      userEmail: 'user@test.com',
      pageUrl: 'https://example.com',
      feedbackText: 'Great feature',
    });

    expect(result.id).toBeTruthy();
    expect(result.userEmail).toBe('user@test.com');
    expect(result.status).toBe('Pending');
    expect(result.createdAt).toBeTruthy();
    expect(result.updatedAt).toBeTruthy();
  });

  it('adds feedback with category', async () => {
    const result = await adapter.add({
      userEmail: 'user@test.com',
      pageUrl: 'https://example.com',
      feedbackText: 'Found a bug',
      category: 'bug',
    });

    expect(result.category).toBe('bug');
  });

  it('retrieves feedback by id', async () => {
    const added = await adapter.add({
      userEmail: 'u@t.com',
      pageUrl: '/page',
      feedbackText: 'Test',
    });

    const found = await adapter.getById(added.id);
    expect(found).toEqual(added);
  });

  it('returns null for non-existent id', async () => {
    const found = await adapter.getById('nonexistent');
    expect(found).toBeNull();
  });

  it('filters by status', async () => {
    const fb = await adapter.add({
      userEmail: 'u@t.com',
      pageUrl: '/p',
      feedbackText: 'Test',
    });

    await adapter.update(fb.id, { status: 'Done' });

    const pending = await adapter.getAll('Pending');
    expect(pending).toHaveLength(0);

    const done = await adapter.getAll('Done');
    expect(done).toHaveLength(1);
  });

  it('returns items sorted by createdAt descending', async () => {
    const first = await adapter.add({
      userEmail: 'u@t.com',
      pageUrl: '/p',
      feedbackText: 'First',
    });
    await new Promise(r => setTimeout(r, 5));
    const second = await adapter.add({
      userEmail: 'u@t.com',
      pageUrl: '/p',
      feedbackText: 'Second',
    });

    const all = await adapter.getAll();
    expect(all[0].id).toBe(second.id);
    expect(all[1].id).toBe(first.id);
  });

  it('updates status and adminNotes', async () => {
    const fb = await adapter.add({
      userEmail: 'u@t.com',
      pageUrl: '/p',
      feedbackText: 'Test',
    });

    await new Promise(r => setTimeout(r, 5));

    const updated = await adapter.update(fb.id, {
      status: 'In Review',
      adminNotes: 'Looking into it',
    });

    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('In Review');
    expect(updated!.adminNotes).toBe('Looking into it');
    expect(updated!.updatedAt).not.toBe(fb.updatedAt);
  });

  it('updates category', async () => {
    const fb = await adapter.add({
      userEmail: 'u@t.com',
      pageUrl: '/p',
      feedbackText: 'Test',
    });

    const updated = await adapter.update(fb.id, { category: 'feature' });
    expect(updated!.category).toBe('feature');
  });

  it('update returns null for non-existent id', async () => {
    const result = await adapter.update('nonexistent', { status: 'Done' });
    expect(result).toBeNull();
  });

  it('sets resolvedAt when status becomes Done', async () => {
    const fb = await adapter.add({
      userEmail: 'u@t.com',
      pageUrl: '/p',
      feedbackText: 'Test',
    });

    const updated = await adapter.update(fb.id, { status: 'Done' });
    expect(updated!.resolvedAt).toBeTruthy();
  });

  it('sets resolvedAt when status becomes Rejected', async () => {
    const fb = await adapter.add({
      userEmail: 'u@t.com',
      pageUrl: '/p',
      feedbackText: 'Test',
    });

    const updated = await adapter.update(fb.id, { status: 'Rejected' });
    expect(updated!.resolvedAt).toBeTruthy();
  });

  it('preserves the original resolvedAt when a resolved status is re-applied', async () => {
    const fb = await adapter.add({
      userEmail: 'u@t.com',
      pageUrl: '/p',
      feedbackText: 'Test',
    });

    const resolved = await adapter.update(fb.id, { status: 'Done' });
    const originalResolvedAt = resolved!.resolvedAt;
    expect(originalResolvedAt).toBeTruthy();

    await new Promise(r => setTimeout(r, 5));

    // Retried/idempotent RESOLVE call (re-sends status while editing notes)
    const retried = await adapter.update(fb.id, { status: 'Done', adminNotes: 'still fixed' });
    expect(retried!.resolvedAt).toBe(originalResolvedAt);

    await new Promise(r => setTimeout(r, 5));

    // Switching between resolved states also keeps the original timestamp
    const rejected = await adapter.update(fb.id, { status: 'Rejected' });
    expect(rejected!.resolvedAt).toBe(originalResolvedAt);
  });

  it('sets a fresh resolvedAt after the item was reopened', async () => {
    const fb = await adapter.add({
      userEmail: 'u@t.com',
      pageUrl: '/p',
      feedbackText: 'Test',
    });

    const first = await adapter.update(fb.id, { status: 'Done' });
    await adapter.update(fb.id, { status: 'Pending' });

    await new Promise(r => setTimeout(r, 5));

    const second = await adapter.update(fb.id, { status: 'Done' });
    expect(second!.resolvedAt).toBeTruthy();
    expect(second!.resolvedAt).not.toBe(first!.resolvedAt);
  });

  it('clears resolvedAt when status goes back to Pending', async () => {
    const fb = await adapter.add({
      userEmail: 'u@t.com',
      pageUrl: '/p',
      feedbackText: 'Test',
    });

    await adapter.update(fb.id, { status: 'Done' });
    const reverted = await adapter.update(fb.id, { status: 'Pending' });
    expect(reverted!.resolvedAt).toBeUndefined();
  });

  it('clears resolvedAt when status goes back to In Review', async () => {
    const fb = await adapter.add({
      userEmail: 'u@t.com',
      pageUrl: '/p',
      feedbackText: 'Test',
    });

    await adapter.update(fb.id, { status: 'Rejected' });
    const reverted = await adapter.update(fb.id, { status: 'In Review' });
    expect(reverted!.resolvedAt).toBeUndefined();
  });

  it('deletes feedback', async () => {
    const fb = await adapter.add({
      userEmail: 'u@t.com',
      pageUrl: '/p',
      feedbackText: 'Test',
    });

    const deleted = await adapter.delete!(fb.id);
    expect(deleted).toBe(true);

    const found = await adapter.getById(fb.id);
    expect(found).toBeNull();
  });

  it('delete returns false for non-existent id', async () => {
    const deleted = await adapter.delete!('nonexistent');
    expect(deleted).toBe(false);
  });

  it('getCount returns total count', async () => {
    await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'A' });
    await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'B' });

    const count = await adapter.getCount!();
    expect(count).toBe(2);
  });

  it('getCount filters by status', async () => {
    const fb = await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'A' });
    await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'B' });
    await adapter.update(fb.id, { status: 'Done' });

    expect(await adapter.getCount!('Pending')).toBe(1);
    expect(await adapter.getCount!('Done')).toBe(1);
  });

  it('bulkUpdate updates multiple items', async () => {
    const fb1 = await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'A' });
    const fb2 = await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'B' });

    const { updated, failed } = await adapter.bulkUpdate!([
      { id: fb1.id, status: 'Done', adminNotes: 'Fixed' },
      { id: fb2.id, status: 'Rejected' },
    ]);

    expect(updated).toHaveLength(2);
    expect(failed).toHaveLength(0);
    expect(updated[0].status).toBe('Done');
    expect(updated[0].adminNotes).toBe('Fixed');
    expect(updated[0].resolvedAt).toBeTruthy();
    expect(updated[1].status).toBe('Rejected');
    expect(updated[1].resolvedAt).toBeTruthy();
  });

  it('bulkUpdate skips non-existent ids', async () => {
    const fb = await adapter.add({ userEmail: 'u@t.com', pageUrl: '/p', feedbackText: 'A' });

    const { updated } = await adapter.bulkUpdate!([
      { id: fb.id, status: 'Done' },
      { id: 'nonexistent', status: 'Done' },
    ]);

    expect(updated).toHaveLength(1);
  });
});
