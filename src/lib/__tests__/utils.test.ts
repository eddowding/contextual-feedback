// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { detectFeedbackContext, getPageContexts } from '../utils';

/** Create a section element with data-feedback-context (and optional id / data-feedback-id). */
function addSection(opts: {
  context: string;
  id?: string;
  feedbackId?: string;
  top?: number;
}): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-feedback-context', opts.context);
  if (opts.id) el.id = opts.id;
  if (opts.feedbackId) el.setAttribute('data-feedback-id', opts.feedbackId);
  if (opts.top !== undefined) {
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      top: opts.top,
      bottom: opts.top + 100,
      left: 0,
      right: 100,
      width: 100,
      height: 100,
      x: 0,
      y: opts.top,
      toJSON: () => ({}),
    } as DOMRect);
  }
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
  window.location.hash = '';
  vi.restoreAllMocks();
});

describe('detectFeedbackContext', () => {
  it('returns General Page when no data-feedback-context elements exist', () => {
    expect(detectFeedbackContext()).toEqual({ context: 'General Page' });
  });

  it('prefers the URL-hash element, using data-feedback-id as elementId', () => {
    window.location.hash = '#pricing';
    addSection({ context: 'Pricing', id: 'pricing', feedbackId: 'price-table' });
    // A decoy section closer to the top of the viewport must not win over the hash.
    addSection({ context: 'Hero', top: 0 });

    expect(detectFeedbackContext()).toEqual({
      context: 'Pricing',
      elementId: 'price-table',
    });
  });

  it('falls back to the hash itself as elementId when data-feedback-id is absent', () => {
    window.location.hash = '#pricing';
    addSection({ context: 'Pricing', id: 'pricing' });

    expect(detectFeedbackContext()).toEqual({
      context: 'Pricing',
      elementId: 'pricing',
    });
  });

  it('ignores a hash element without data-feedback-context and falls through to sections', () => {
    window.location.hash = '#plain';
    const plain = document.createElement('div');
    plain.id = 'plain';
    document.body.appendChild(plain);
    addSection({ context: 'Features', id: 'features', top: 50 });

    expect(detectFeedbackContext()).toEqual({
      context: 'Features',
      elementId: 'features',
    });
  });

  it('excludes sections above the -200px visibility threshold', () => {
    addSection({ context: 'Scrolled Past', id: 'past', top: -300 });
    addSection({ context: 'Visible', id: 'visible', top: 50 });

    expect(detectFeedbackContext()).toEqual({
      context: 'Visible',
      elementId: 'visible',
    });
  });

  it('picks the section closest to the top of the viewport on ties', () => {
    addSection({ context: 'Lower', id: 'lower', top: 100 });
    addSection({ context: 'Upper', id: 'upper', top: 10 });

    expect(detectFeedbackContext()).toEqual({
      context: 'Upper',
      elementId: 'upper',
    });
  });

  it('prefers data-feedback-id over the element id for the winning section', () => {
    addSection({ context: 'Docs', id: 'docs-section', feedbackId: 'docs', top: 20 });

    expect(detectFeedbackContext()).toEqual({
      context: 'Docs',
      elementId: 'docs',
    });
  });

  it('returns General Page when every section is outside the threshold', () => {
    addSection({ context: 'Gone', top: -500 });

    expect(detectFeedbackContext()).toEqual({ context: 'General Page' });
  });
});

describe('getPageContexts', () => {
  it('returns just General Page when no sections exist', () => {
    expect(getPageContexts()).toEqual(['General Page']);
  });

  it('returns sorted unique context names including General Page', () => {
    addSection({ context: 'Pricing' });
    addSection({ context: 'Features' });
    addSection({ context: 'Pricing' }); // duplicate — must be de-duplicated

    expect(getPageContexts()).toEqual(['Features', 'General Page', 'Pricing']);
  });
});
