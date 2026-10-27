import assert from 'node:assert/strict';
import test from 'node:test';
import { NarrativeService } from '../src/narrative/service.js';
import type { NarrativeProvider } from '../src/narrative/provider.js';
import { draft, fixtureInsights } from './narrative-fixtures.js';
import { period } from './fixtures.js';

function provider(generate: NarrativeProvider['generate']): NarrativeProvider {
  return { model: 'fixture-model', configured: true, generate };
}

test('narrative is generated once, carries exact fact/PR evidence, and caches validated output', async () => {
  let calls = 0;
  const service = new NarrativeService(fixtureInsights(), provider(async () => { calls++; return draft(); }), 300);
  const first = await service.get('acme', 'project', period);
  assert.equal(first.cache.hit, false);
  assert.equal(first.hypothesis.confidence, 0.35);
  assert.ok(first.narrative.includes('Four PRs'));
  assert.equal(first.citedFacts.length, 6);
  assert.deepEqual(first.evidence.map(row => row.number), [1, 2, 3, 4, 6]);
  const second = await service.get('acme', 'project', period);
  assert.equal(second.cache.hit, true);
  assert.equal(second.generatedAt, first.generatedAt);
  assert.deepEqual(second.hypothesis, first.hypothesis);
  assert.equal(calls, 1);
});

test('identical concurrent requests share one paid generation; distinct work is rejected as busy', async () => {
  let calls = 0;
  let finish!: () => void;
  const wait = new Promise<void>(resolve => { finish = resolve; });
  const service = new NarrativeService(fixtureInsights(), provider(async () => { calls++; await wait; return draft(); }), 300);
  const first = service.get('acme', 'project', period);
  await new Promise(resolve => setImmediate(resolve));
  const duplicate = service.get('acme', 'project', period);
  await assert.rejects(service.get('acme', 'project', { from: '2026-01-02T00:00:00Z', to: '2026-02-02T00:00:00Z' }), { code: 'NARRATIVE_BUSY' });
  finish();
  const results = await Promise.all([first, duplicate]);
  assert.equal(calls, 1);
  assert.equal(results[0]!.generatedAt, results[1]!.generatedAt);
});

test('failed or incorrectly cited generations are not cached and the next request can recover', async () => {
  let calls = 0;
  const service = new NarrativeService(fixtureInsights(), provider(async () => {
    calls++;
    const value = draft();
    if (calls === 1) value.observations[0]!.evidence[0]!.value = 999;
    return value;
  }), 300);
  await assert.rejects(service.get('acme', 'project', period), { code: 'LLM_INVALID_EVIDENCE' });
  assert.equal((await service.get('acme', 'project', period)).cache.hit, false);
  assert.equal(calls, 2);
});

test('TTL expiry and a refreshed source timestamp each trigger fresh generation', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  let calls = 0;
  const report = await fixtureInsights().get('acme', 'project', period);
  const source = { get: async () => report };
  const service = new NarrativeService(source, provider(async () => { calls++; return draft(); }), 5);
  await service.get('acme', 'project', period);
  assert.equal((await service.get('acme', 'project', period)).cache.hit, true);
  t.mock.timers.tick(5001);
  assert.equal((await service.get('acme', 'project', period)).cache.hit, false);
  report.source.fetchedAt = '2026-02-02T00:00:01.000Z';
  assert.equal((await service.get('acme', 'project', period)).cache.hit, false);
  assert.equal(calls, 3);
});

test('missing configuration fails before GitHub collection', async () => {
  let reads = 0;
  const service = new NarrativeService({ get: async () => { reads++; throw new Error('must not fetch'); } },
    { model: 'fixture', configured: false, generate: async () => draft() }, 300);
  await assert.rejects(service.get('acme', 'project', period), { code: 'LLM_NOT_CONFIGURED' });
  assert.equal(reads, 0);
});

test('bounded narrative cache evicts old results and does not retain oversized evidence responses', async () => {
  let calls = 0;
  const report = await fixtureInsights().get('acme', 'project', period);
  const service = new NarrativeService({ get: async () => report }, provider(async () => { calls++; return draft(); }), 300);
  for (let i = 0; i < 51; i++) {
    report.source.fetchedAt = new Date(Date.parse('2026-02-02T00:00:00Z') + i * 1000).toISOString();
    await service.get('acme', 'project', period);
  }
  report.source.fetchedAt = '2026-02-02T00:00:00.000Z';
  assert.equal((await service.get('acme', 'project', period)).cache.hit, false);
  assert.equal(calls, 52);

  const largeReport = structuredClone(report);
  largeReport.evidence[0]!.url += 'x'.repeat(1024 * 1024);
  const large = new NarrativeService({ get: async () => largeReport }, provider(async () => { calls++; return draft(); }), 300);
  await large.get('acme', 'project', period);
  assert.equal((await large.get('acme', 'project', period)).cache.hit, false);
  assert.equal(calls, 54);
});
