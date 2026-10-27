import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { IngestionService } from '../src/github/ingestion.js';
import { SqliteSnapshotCache } from '../src/storage/cache.js';
import { analyticSnapshot } from './insights-fixtures.js';
import { draft } from './narrative-fixtures.js';

const execute = promisify(execFile);
const periodArgs = [
  '--repository',
  'acme/project',
  '--from',
  '2026-01-01T00:00:00Z',
  '--to',
  '2026-02-01T00:00:00Z',
];

test('smoke CLI exercises HTTP, checks evidence/cache, and only calls a provider with an explicit flag', async (t) => {
  let calls = 0;
  const app = buildApp(
    loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_PATH: ':memory:',
    }),
    {
      ingestion: new IngestionService(
        {
          collect: async (_owner, _repo, period) => ({
            ...analyticSnapshot,
            period,
          }),
        },
        new SqliteSnapshotCache(':memory:', 300),
        300,
      ),
      narrativeProvider: {
        model: 'fixture',
        configured: true,
        generate: async () => {
          calls++;
          return draft();
        },
      },
    },
  );
  t.after(() => app.close());
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const args = ['scripts/smoke.mjs', '--base-url', address, ...periodArgs];
  const first = await execute(process.execPath, args, { timeout: 30_000 });
  assert.match(
    first.stdout,
    /PASS GitHub insights and evidence \(4 selected \/ 1 previous/,
  );
  assert.match(first.stdout, /SKIP LLM generation/);
  assert.equal(calls, 0);
  const withNarrative = await execute(
    process.execPath,
    [...args, '--narrative'],
    { timeout: 30_000 },
  );
  assert.match(
    withNarrative.stdout,
    /PASS narrative citations, confidence policy, and repeat cache hit/,
  );
  assert.match(withNarrative.stdout, /MANUAL REVIEW required/);
  assert.equal(calls, 1);
});

test('explicit narrative smoke fails when no real provider configuration is available', async (t) => {
  const app = buildApp(
    loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_PATH: ':memory:',
    }),
    {
      ingestion: new IngestionService(
        { collect: async () => analyticSnapshot },
        new SqliteSnapshotCache(':memory:', 300),
        300,
      ),
    },
  );
  t.after(() => app.close());
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  await assert.rejects(
    execute(process.execPath, [
      'scripts/smoke.mjs',
      '--base-url',
      address,
      ...periodArgs,
      '--narrative',
    ]),
    (error: unknown) => {
      const failure = error as { code: number; stdout: string; stderr: string };
      assert.equal(failure.code, 1);
      assert.match(failure.stderr, /HTTP 503 LLM_NOT_CONFIGURED/);
      assert.ok(!failure.stdout.includes('PASS narrative'));
      return true;
    },
  );
});

test('UI-only packaging smoke skips external APIs and credential-bearing URLs are rejected without echoing them', async (t) => {
  let collects = 0;
  const app = buildApp(
    loadConfig({ LOG_LEVEL: 'silent', DATABASE_PATH: ':memory:' }),
    {
      ingestion: new IngestionService(
        {
          collect: async () => {
            collects++;
            return analyticSnapshot;
          },
        },
        new SqliteSnapshotCache(':memory:', 300),
        300,
      ),
    },
  );
  t.after(() => app.close());
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const result = await execute(process.execPath, [
    'scripts/smoke.mjs',
    '--base-url',
    address,
    '--ui-only',
  ]);
  assert.match(result.stdout, /SKIP GitHub\/LLM checks/);
  assert.equal(collects, 0);
  await assert.rejects(
    execute(process.execPath, [
      'scripts/smoke.mjs',
      '--base-url',
      'http://user:fixture-sensitive@localhost',
    ]),
    (error: unknown) => {
      const failure = error as { stderr: string; code: number };
      assert.equal(failure.code, 1);
      assert.ok(!failure.stderr.includes('fixture-sensitive'));
      assert.match(failure.stderr, /without credentials/);
      return true;
    },
  );
});
