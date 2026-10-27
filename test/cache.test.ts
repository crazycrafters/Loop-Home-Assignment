import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { SqliteSnapshotCache } from '../src/storage/cache.js';
import { snapshot } from './fixtures.js';

test('SQLite cache persists across workers, respects expiry, and bounds row count', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'loop-cache-'));
  const path = join(directory, 'nested', 'cache.sqlite');
  t.after(() => rm(directory, { recursive: true, force: true }));
  const first = new SqliteSnapshotCache(path, 300);
  assert.equal(await first.get('missing'), null);
  await first.set('snapshot', snapshot);
  await first.close();
  const second = new SqliteSnapshotCache(path, 300);
  t.after(() => second.close());
  assert.deepEqual(await second.get('snapshot'), snapshot);
  // Expire persisted state directly rather than sleeping or relying on wall-clock races.
  const db = new DatabaseSync(path);
  t.after(() => db.close());
  db.prepare('UPDATE snapshots SET expires_at = 0 WHERE key = ?').run('snapshot');
  assert.equal(await second.get('snapshot'), null);
  for (let i = 0; i < 102; i++) await second.set(`key-${i}`, snapshot);
  const count = db.prepare('SELECT COUNT(*) AS n FROM snapshots').get() as { n: number };
  assert.equal(count.n, 100);
});

test('cache rejects oversized writes without replacing previous valid state', async t => {
  const cache = new SqliteSnapshotCache(':memory:', 300);
  t.after(() => cache.close());
  await cache.set('key', snapshot);
  await assert.rejects(cache.set('key', { ...snapshot, repository: 'x'.repeat(8 * 1024 * 1024) }),
    { code: 'COLLECTION_LIMIT' });
  assert.deepEqual(await cache.get('key'), snapshot);
});

test('worker startup errors reject requests safely and close remains usable', async () => {
  const cache = new SqliteSnapshotCache('/dev/null/not-a-directory/cache.sqlite', 300);
  await assert.rejects(cache.get('key'), { code: 'STORAGE_UNAVAILABLE' });
  await cache.close();
});
