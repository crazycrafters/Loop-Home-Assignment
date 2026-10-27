import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { ServiceError } from '../src/errors.js';
import { GitHubClient } from '../src/github/client.js';
import { GitHubCollector } from '../src/github/collector.js';
import { IngestionService } from '../src/github/ingestion.js';
import { SqliteSnapshotCache } from '../src/storage/cache.js';
import { fakeFetch, json, metadata, period, pull, review } from './fixtures.js';

const config = () => loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_PATH: ':memory:' });

test('HTTP sync traverses upstream, persists a snapshot, and then serves it from cache', async t => {
  let calls = 0;
  const client = new GitHubClient(undefined, fakeFetch(url => {
    calls++;
    if (url.pathname.endsWith('/reviews')) return json([review]);
    if (url.pathname.endsWith('/1')) return json(pull);
    if (url.pathname.endsWith('/pulls')) return json(url.searchParams.get('state') === 'open' ? [] : [pull]);
    return json(metadata);
  }));
  const ingestion = new IngestionService(new GitHubCollector(client), new SqliteSnapshotCache(':memory:', 300), 300);
  const server = buildApp(config(), { ingestion });
  t.after(() => server.close());
  const first = await server.inject({ method: 'POST', url: '/api/repos/acme/project/sync', payload: period });
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json().cache.hit, false);
  assert.equal(first.json().snapshot.pulls[0].reviews[0].author, 'reviewer');
  assert.equal(first.headers['cache-control'], 'no-store');
  const upstreamCalls = calls;
  const second = await server.inject({ method: 'POST', url: '/api/repos/acme/project/sync', payload: period });
  assert.equal(second.statusCode, 200);
  assert.equal(second.json().cache.hit, true);
  assert.deepEqual(second.json().snapshot, first.json().snapshot);
  assert.equal(calls, upstreamCalls);
});

test('invalid repository names and date ranges fail before any ingestion', async t => {
  const server = buildApp(config());
  t.after(() => server.close());
  for (const [url, payload] of [
    ['/api/repos/acme/project/sync', {}],
    ['/api/repos/acme/project/sync', { from: 'not-a-date', to: period.to }],
    ['/api/repos/acme/project/sync', { from: period.to, to: period.from }],
    ['/api/repos/acme/project/sync', { from: period.from, to: '2026-06-01T00:00:00Z' }],
    ['/api/repos/acme/project/sync', { ...period, token: 'must-not-be-echoed' }],
    ['/api/repos/bad%20owner/project/sync', period],
    ['/api/repos/acme/bad%3Frepo/sync', period],
  ] as const) {
    const response = await server.inject({ method: 'POST', url, payload });
    assert.equal(response.statusCode, 400, response.body);
    assert.equal(response.json().code, 'INVALID_INPUT');
    assert.ok(!response.body.includes('must-not-be-echoed'));
  }
});

test('HTTP upstream rate limits expose safe retry guidance', async t => {
  const ingestion = new IngestionService({ collect: async () => {
    throw new ServiceError(503, 'GITHUB_RATE_LIMITED', 'GitHub rate limit reached', 120);
  } }, new SqliteSnapshotCache(':memory:', 300), 300);
  const server = buildApp(config(), { ingestion });
  t.after(() => server.close());
  const response = await server.inject({ method: 'POST', url: '/api/repos/acme/project/sync', payload: period });
  assert.equal(response.statusCode, 503);
  assert.equal(response.headers['retry-after'], '120');
  assert.equal(response.json().code, 'GITHUB_RATE_LIMITED');
});
