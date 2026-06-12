import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

/**
 * styles.css ships as a static asset (copied to dist/), so these guarantees
 * are asserted against the source text.
 */
describe('styles.css accessibility guarantees', () => {
  describe('focus indicators (WCAG 2.4.7 / 1.4.11)', () => {
    it('does not use the invisible 10%-alpha focus ring anywhere', () => {
      expect(css).not.toContain('rgba(59, 130, 246, 0.1)');
    });

    it('form controls get a visible solid focus outline instead of outline: none', () => {
      for (const selector of ['.cf-input:focus', '.cf-textarea:focus', '.cf-context-select:focus']) {
        const block = css.split(selector)[1]?.split('}')[0] ?? '';
        expect(block, `${selector} must have a solid outline`).toContain('outline: 2px solid #1d4ed8');
        expect(block, `${selector} must not suppress the outline`).not.toContain('outline: none');
      }
    });

    it('buttons and icon controls share a :focus-visible indicator', () => {
      for (const selector of [
        '.cf-btn:focus-visible',
        '.cf-floating-button:focus-visible',
        '.cf-central-button:focus-visible',
        '.cf-dialog-close:focus-visible',
        '.cf-context-edit:focus-visible',
      ]) {
        expect(css).toContain(selector);
      }
    });
  });

  describe('colour contrast (WCAG 1.4.3 / 1.4.11)', () => {
    it('no white-on-#3b82f6 button/tooltip backgrounds remain', () => {
      expect(css).not.toContain('background: #3b82f6');
      expect(css).not.toContain('background: rgba(59, 130, 246, 0.95)');
      expect(css).not.toContain('linear-gradient(135deg, #3b82f6');
    });

    it('active feedback-mode state uses a dark green, not #22c55e', () => {
      expect(css).not.toMatch(/background:\s*#22c55e/);
      expect(css).toContain('background: #15803d');
    });

    it('low-contrast #9ca3af grey is not used for text or icons', () => {
      expect(css).not.toMatch(/color:\s*#9ca3af/);
    });

    it('section highlight outline is a solid colour, not alpha blue', () => {
      expect(css).toContain('outline: 3px solid #2563eb !important');
      expect(css).not.toContain('outline: 3px solid rgba(59, 130, 246, 0.6)');
    });
  });

  describe('prefers-reduced-motion', () => {
    const block = css.split('@media (prefers-reduced-motion: reduce)')[1] ?? '';

    it('defines a reduced-motion media query', () => {
      expect(block).not.toBe('');
    });

    it('disables dialog animations and hover scaling, keeps spinners running slowly', () => {
      expect(block).toContain('animation: none');
      expect(block).toContain('.cf-floating-button:hover');
      expect(block).toContain('animation-duration: 1.5s');
    });

    it('preserves positioning transforms of the rotated edge-tab variants', () => {
      expect(block).toContain('transform: translateY(-50%) rotate(-90deg)');
      expect(block).toContain('transform: translateY(-50%) rotate(90deg)');
      expect(block).toContain('transform: translate(-50%, -50%)');
    });

    it('only scopes transition resets to cf- classes, never the host app', () => {
      // A bare `* { ... }` reset inside the media query would leak into the
      // consuming application's own elements.
      expect(block).not.toMatch(/^\s*\*\s*\{/m);
    });
  });
});

describe('build configuration', () => {
  const tsupConfig = readFileSync(new URL('../../tsup.config.ts', import.meta.url), 'utf8');
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    scripts: Record<string, string>;
  };

  it('no tsup config sets clean: true (races the parallel config and deletes its output)', () => {
    // Anchored to line start so the explanatory comment in the config
    // ("no `clean: true` here") doesn't trip the check.
    expect(tsupConfig).not.toMatch(/^\s*clean:\s*true/m);
  });

  it('the build script wipes dist/ once before tsup starts', () => {
    expect(pkg.scripts.build).toBe('rm -rf dist && tsup');
  });

  it('watch mode does not clean (would leave server bundles missing until their sources change)', () => {
    expect(pkg.scripts.dev).toBe('tsup --watch');
  });
});
