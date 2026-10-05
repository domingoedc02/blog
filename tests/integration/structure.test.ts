import fs from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

/**
 * Asserts the repository tree matches spec/file-structure's layout for
 * everything this scaffolding task (BLOG-19) is responsible for creating.
 */
const ROOT = path.resolve(__dirname, '..', '..');

const EXPECTED_PATHS = [
  'package.json',
  'pnpm-lock.yaml',
  'tsconfig.json',
  'next.config.ts',
  'eslint.config.mjs',
  '.prettierrc',
  '.prettierignore',
  '.gitignore',
  '.env.example',
  'drizzle.config.ts',
  'src/app/(public)/layout.tsx',
  'src/app/admin/layout.tsx',
  'src/lib/env.ts',
  'src/middleware.ts',
  'src/styles/globals.css',
  'public/favicon.ico',
  'public/og-default.png',
  'tests/unit',
  'tests/integration',
  'tests/e2e',
];

describe('repository structure (spec/file-structure)', () => {
  for (const relativePath of EXPECTED_PATHS) {
    it(`has ${relativePath}`, () => {
      expect(fs.existsSync(path.join(ROOT, relativePath))).toBe(true);
    });
  }

  it('has no pnpm-workspace.yaml (single package, per BLOG-19)', () => {
    expect(fs.existsSync(path.join(ROOT, 'pnpm-workspace.yaml'))).toBe(false);
  });
});
