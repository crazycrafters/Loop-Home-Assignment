import assert from 'node:assert/strict';
import test from 'node:test';
import { IngestionService } from '../src/github/ingestion.js';
import type { SnapshotCache } from '../src/storage/cache.js';
import type { Snapshot } from '../src/github/model.js';
import { period, snapshot } from './fixtures.js';

function cache(): SnapshotCache {
  const entries = new Map<string, Snapshot>();
  return {
    get: async key => entries.get(key) ?? null,
    set: async (key, value) => { entries.set(key, value); },
    close: async () => {},
  };
}

test('cache keys normalize repository case and equivalent timestamps', async () => {
  let calls = 0;
  const service = new IngestionService({ collect: async () => { calls++; return snapshot; } }, cache(), 300);
  assert.equal((await service.sync('acme', 'project', period)).cache.hit, false);
  assert.equal((await service.sync('ACME', 'PROJECT', {
    from: '2025-12-31T19:00:00-05:00', to: '2026-01-31T19:00:00-05:00',
  })).cache.hit, true);
  assert.equal(calls, 1);
});

test('simultaneous identical syncs share one collection', async () => {
  let calls = 0;
  const service = new IngestionService({ collect: async () => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 10));
    return snapshot;
  } }, cache(), 300);
  const results = await Promise.all(Array.from({ length: 5 }, () => service.sync('acme', 'project', period)));
  assert.equal(calls, 1);
  assert.ok(results.every(value => value.snapshot === snapshot));
});

test('failed collections are not cached and can be retried', async () => {
  let calls = 0;
  const service = new IngestionService({ collect: async () => {
    if (++calls === 1) throw new Error('upstream failed');
    return snapshot;
  } }, cache(), 300);
  await assert.rejects(service.sync('acme', 'project', period));
  assert.equal((await service.sync('acme', 'project', period)).cache.hit, false);
  assert.equal(calls, 2);
});

test('limits distinct concurrent syncs, permits a duplicate, then recovers', async () => {
  let finish!: () => void;
  const wait = new Promise<void>(resolve => { finish = resolve; });
  const service = new IngestionService({ collect: async () => { await wait; return snapshot; } }, cache(), 300);
  const first = service.sync('acme', 'one', period);
  const second = service.sync('acme', 'two', period);
  // Allow the async cache lookups to finish before testing admission.
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(service.sync('acme', 'three', period), { code: 'SYNC_BUSY' });
  const duplicate = service.sync('acme', 'one', period);
  finish();
  await Promise.all([first, second, duplicate]);
  assert.equal((await service.sync('acme', 'three', period)).cache.hit, false);
});
