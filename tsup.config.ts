import { defineConfig } from 'tsup';

export default defineConfig([
  {
    // Client entry (has React components — needs 'use client')
    entry: { index: 'src/index.ts' },
    banner: { js: '"use client";' },
    format: ['cjs', 'esm'],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true,
    external: ['react', 'react-dom'],
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
