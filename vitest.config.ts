import path from 'path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'server-only': path.resolve(__dirname, './tests/stubs/server-only.ts'),
    },
  },
  // No test imports CSS; this stops Vite from discovering the repo's
  // Next.js-flavoured postcss.config.mjs (string plugin names, which only
  // Next's own loader resolves) and choking on it.
  css: {
    postcss: {
      plugins: [],
    },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    // The tests/integration/db/** suite (BLOG-22) shares one disposable
    // Postgres across files and spawns the real seed/migrate scripts as
    // child processes; running test files in parallel would let them
    // stomp on each other's rows/migrations table. Headers.test.ts
    // (BLOG-19) also spawns a real dev server — sequential execution
    // keeps all of this deterministic at the cost of a slower run.
    fileParallelism: false,
  },
});
