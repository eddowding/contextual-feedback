import { defineConfig } from 'tsup';
import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

export default defineConfig([
  {
    // Client entry (has React components — needs 'use client')
    entry: { index: 'src/index.ts' },
    banner: { js: '"use client";' },
    format: ['cjs', 'esm'],
    dts: true,
    splitting: false,
    sourcemap: true,
    // NOTE: no `clean: true` here — the two configs in this array build
    // concurrently, so a clean at the start of this one races the other
    // config's writes and can silently delete its output (worst in watch
    // mode). The build script wipes dist/ once before tsup starts instead.
    // NOTE: do not enable `treeshake` here — the rollup treeshake pass drops the
    // `"use client"` banner, breaking the client components in Next.js App Router.
    // Consumer-side tree-shaking is handled by `"sideEffects"` in package.json.
    external: ['react', 'react-dom'],
    // Ship the stylesheet alongside the build so the
    // `contextual-feedback/styles.css` export resolves for consumers.
    onSuccess: async () => {
      copyFileSync(
        resolve(__dirname, 'src/styles.css'),
        resolve(__dirname, 'dist/styles.css')
      );
    },
  },
  {
    // Server entries (no 'use client')
    entry: {
      'lib/ai': 'src/lib/ai.ts',
      'lib/adapters/postgres': 'src/lib/adapters/postgres.ts',
      'lib/adapters/supabase': 'src/lib/adapters/supabase.ts',
      'lib/adapters/memory': 'src/lib/adapters/memory.ts',
      'api/handlers': 'src/api/handlers.ts',
      'setup/supabase': 'src/setup/supabase.ts',
    },
    format: ['cjs', 'esm'],
    dts: true,
    splitting: false,
    sourcemap: true,
    external: ['react', 'react-dom'],
  },
]);
