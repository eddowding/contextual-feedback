import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'lib/adapters/postgres': 'src/lib/adapters/postgres.ts',
    'lib/adapters/supabase': 'src/lib/adapters/supabase.ts',
    'lib/adapters/memory': 'src/lib/adapters/memory.ts',
    'api/handlers': 'src/api/handlers.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  external: ['react', 'react-dom'],
  banner: {
    js: '"use client";',
  },
});
