import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { ServiceError } from '../src/errors.js';
import { IngestionService, type Collector } from '../src/github/ingestion.js';
import { SqliteSnapshotCache } from '../src/storage/cache.js';
import { InsightsService } from '../src/insights/service.js';
import { period } from './fixtures.js';
import { analyticSnapshot } from './insights-fixtures.js';

const endpoint = (range = period) => `/api/repos/acme/project/insights?${new URLSearchParams(range)}`;
const config = () => loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_PATH: ':memory:' });
const ingestion = (collector: Collector) => new IngestionService(collector, new SqliteSnapshotCache(':memory:', 300), 300);

test('HTTP insights uses one combined collection and returns cached, reproducible baseline metrics', async t => {
  let collections = 0;
  const service = ingestion({ collect: async (owner, repo, collectionPeriod) => {
    collections++;
    assert.equal(owner, 'acme');
    assert.equal(repo, 'project');
    assert.deepEqual(collectionPeriod, { from: '2025-12-01T00:00:00.000Z', to: period.to });
    return { ...analyticSnapshot, period: collectionPeriod };
  } });
  const app = buildApp(config(), { ingestion: service });
  t.after(() => app.close());
  const first = await app.inject({ method: 'GET', url: endpoint() });
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.headers['cache-control'], 'no-store');
  const result = first.json();
  assert.equal(result.repository, 'acme/project');
  assert.equal(result.source.cache.hit, false);
  assert.equal(result.current.metrics.mergedPrCount.value, 4);
  assert.equal(result.previous.metrics.mergedPrCount.value, 1);
  assert.equal(result.changes.mergedPrCount.relativePercent, 300);
  assert.equal(result.currentBacklog.openPrCount, 2);
  assert.equal(result.definitions.medianMergeHours.unit, 'hours');
  assert.equal(result.schemaVersion, '1');
  assert.ok(result.warnings.some((warning: { code: string }) => warning.code === 'SMALL_MERGED_SAMPLE'));
  const evidenceIds = new Set(result.evidence.map((row: { id: string }) => row.id));
  for (const row of result.current.contributors) for (const id of row.evidenceIds) assert.ok(evidenceIds.has(id));
  const repeated = await app.inject({ method: 'GET', url: endpoint() });
  assert.equal(repeated.statusCode, 200);
  assert.equal(repeated.json().source.cache.hit, true);
  assert.deepEqual(repeated.json().current, result.current);
  assert.deepEqual(repeated.json().previous, result.previous);
  assert.deepEqual(repeated.json().evidence, result.evidence);
  assert.equal(collections, 1);
});

test('UTC normalization preserves exact elapsed duration across an offset/DST boundary', async t => {
  let received: unknown;
  const service = ingestion({ collect: async (_owner, _repo, range) => {
    received = range;
    return { ...analyticSnapshot, period: range, pulls: [] };
  } });
  t.after(() => service.close());
  const result = await new InsightsService(service).get('acme', 'project', {
    from: '2026-03-07T12:00:00-05:00', to: '2026-03-09T12:00:00-04:00',
  });
  assert.deepEqual(result.current.period, { from: '2026-03-07T17:00:00.000Z', to: '2026-03-09T16:00:00.000Z' });
  assert.deepEqual(result.previous.period, { from: '2026-03-05T18:00:00.000Z', to: '2026-03-07T17:00:00.000Z' });
  assert.deepEqual(received, { from: '2026-03-05T18:00:00.000Z', to: '2026-03-09T16:00:00.000Z' });
  assert.ok(result.warnings.some(warning => warning.code === 'PERIOD_NOT_COMPLETE'));
});

test('90-day requested periods collect a bounded 180-day source window', async t => {
  let received: unknown;
  const service = ingestion({ collect: async (_owner, _repo, range) => {
    received = range;
    return { ...analyticSnapshot, period: range, pulls: [] };
  } });
  const app = buildApp(config(), { ingestion: service });
  t.after(() => app.close());
  const result = await app.inject({ method: 'GET', url: endpoint({ from: '2026-01-01T00:00:00Z', to: '2026-04-01T00:00:00Z' }) });
  assert.equal(result.statusCode, 200, result.body);
  assert.deepEqual(received, { from: '2025-10-03T00:00:00.000Z', to: '2026-04-01T00:00:00.000Z' });
});

test('invalid or repeated query parameters fail before collection', async t => {
  let calls = 0;
  const app = buildApp(config(), { ingestion: ingestion({ collect: async () => {
    calls++; return analyticSnapshot;
  } }) });
  t.after(() => app.close());
  for (const url of [
    '/api/repos/acme/project/insights',
    endpoint({ from: '2026-01-01', to: period.to }),
    endpoint({ from: period.to, to: period.from }),
    endpoint({ from: period.from, to: period.from }),
    endpoint({ from: period.from, to: '2026-05-01T00:00:00Z' }),
    endpoint() + '&from=2026-01-10T00:00:00Z',
    endpoint() + '&upstream=https://attacker.example',
    endpoint().replace('/acme/', '/bad%20owner/'),
  ]) {
    const response = await app.inject(url);
    assert.equal(response.statusCode, 400, response.body);
    assert.equal(response.json().code, 'INVALID_INPUT');
  }
  assert.equal(calls, 0);
});

test('upstream failure produces an error rather than misleading zero metrics', async t => {
  const app = buildApp(config(), { ingestion: ingestion({ collect: async () => {
    throw new ServiceError(503, 'GITHUB_RATE_LIMITED', 'GitHub rate limit reached', 60);
  } }) });
  t.after(() => app.close());
  const response = await app.inject(endpoint());
  assert.equal(response.statusCode, 503);
  assert.equal(response.headers['retry-after'], '60');
  assert.equal(response.json().code, 'GITHUB_RATE_LIMITED');
  assert.equal(response.json().current, undefined);
});

test('identical simultaneous insights requests share ingestion and retain identical evidence', async t => {
  let calls = 0;
  const app = buildApp(config(), { ingestion: ingestion({ collect: async () => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 10));
    return analyticSnapshot;
  } }) });
  t.after(() => app.close());
  const results = await Promise.all(Array.from({ length: 3 }, () => app.inject(endpoint())));
  for (const result of results) {
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.json().evidence, results[0]!.json().evidence);
  }
  assert.equal(calls, 1);
});
