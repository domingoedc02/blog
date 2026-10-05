import { execFile } from 'child_process';
import path from 'path';
import { promisify } from 'util';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { db as Db } from '@/lib/db/client';

import { migrateTestDb } from './migrate-test-db';
import { applyTestEnv, testDatabaseUrl } from './test-env';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(__dirname, '..', '..', '..');

applyTestEnv();

let db: typeof Db;

beforeAll(async () => {
  await migrateTestDb();
  ({ db } = await import('@/lib/db/client'));
}, 30_000);

afterAll(async () => {
  // Only the fixed slugs/names scripts/seed.ts creates — leaves any other
  // test file's (already-cleaned-up) rows alone.
  await db.execute(sql`
    DELETE FROM posts WHERE slug IN (
      'why-postgres-is-still-the-right-default',
      'typescript-strict-mode-is-worth-it',
      'notes-on-switching-roles'
    )
  `);
  await db.execute(
    sql`DELETE FROM tags WHERE name IN ('typescript', 'nextjs', 'postgres', 'career', 'devops')`,
  );
});

async function runSeedScript(): Promise<string> {
  const { stdout } = await execFileAsync('pnpm', ['exec', 'tsx', 'scripts/seed.ts'], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
  });
  return stdout;
}

async function countSeedTags(): Promise<string> {
  const result = await db.execute<{ count: string }>(sql`
    SELECT count(*)::text AS count FROM tags
    WHERE name IN ('typescript', 'nextjs', 'postgres', 'career', 'devops')
  `);
  return result.rows[0]?.count ?? '0';
}

async function countSeedPosts(): Promise<string> {
  const result = await db.execute<{ count: string }>(sql`
    SELECT count(*)::text AS count FROM posts WHERE slug IN (
      'why-postgres-is-still-the-right-default',
      'typescript-strict-mode-is-worth-it',
      'notes-on-switching-roles'
    )
  `);
  return result.rows[0]?.count ?? '0';
}

describe('pnpm db:seed idempotency (BLOG-22 AC5)', () => {
  it('running the seed script twice does not duplicate the 5 tags or 3 posts', async () => {
    await runSeedScript();

    expect(await countSeedTags()).toBe('5');
    expect(await countSeedPosts()).toBe('3');

    await runSeedScript();

    expect(await countSeedTags()).toBe('5');
    expect(await countSeedPosts()).toBe('3');
  }, 30_000);
});
