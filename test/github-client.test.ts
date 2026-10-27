import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { ServiceError } from '../src/errors.js';
import { GitHubClient } from '../src/github/client.js';
import { fakeFetch, json } from './fixtures.js';

const signal = () => AbortSignal.timeout(1000);

test('fixed GitHub origin, safe headers, optional token, and no redirect following', async () => {
  const client = new GitHubClient('do-not-log', fakeFetch((url, init) => {
    assert.equal(url.origin, 'https://api.github.com');
    assert.equal(init?.redirect, 'error');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer do-not-log');
    assert.equal((init?.headers as Record<string, string>)['X-GitHub-Api-Version'], '2022-11-28');
    assert.ok(init?.signal);
    return json({ value: 1 });
  }));
  assert.deepEqual((await client.get('/repos/a/b', z.object({ value: z.number() }), signal())).data, { value: 1 });
});

test('pagination increments locally and never follows an untrusted Link destination', async () => {
  const pages: string[] = [];
  const client = new GitHubClient(undefined, fakeFetch(url => {
    pages.push(url.href);
    return url.searchParams.get('page') === '1'
      ? json([1], 200, { link: '<https://attacker.example/steal>; rel="next"' }) : json([2]);
  }));
  const result = [];
  for await (const page of client.pages('/repos/a/b/pulls?state=open', z.number(), signal())) result.push(...page);
  assert.deepEqual(result, [1, 2]);
  assert.ok(pages.every(url => url.startsWith('https://api.github.com/repos/a/b/pulls?')));
  assert.match(pages[1]!, /page=2/);
});

test('pagination limit fails explicitly instead of returning partial success', async () => {
  let calls = 0;
  const client = new GitHubClient(undefined, fakeFetch(() => {
    calls++;
    return json([1], 200, { link: '<ignored>; rel="next"' });
  }));
  await assert.rejects(async () => {
    for await (const _ of client.pages('/repos/a/b/pulls', z.number(), signal())) { /* consume */ }
  }, { code: 'COLLECTION_LIMIT' });
  assert.equal(calls, 20);
});

test('rate limits return bounded retry guidance without exposing upstream text', async () => {
  for (const [status, headers] of [
    [429, { 'retry-after': '120' }],
    [403, { 'x-ratelimit-remaining': '0', 'retry-after': '9999999' }],
  ] as const) {
    const client = new GitHubClient(undefined, fakeFetch(() => json({ message: 'secret upstream text' }, status, headers)));
    await assert.rejects(client.get('/repos/a/b', z.unknown(), signal()), (error: unknown) => {
      assert.ok(error instanceof ServiceError);
      assert.equal(error.code, 'GITHUB_RATE_LIMITED');
      assert.equal(error.statusCode, 503);
      assert.ok(error.retryAfter !== undefined && error.retryAfter > 0 && error.retryAfter <= 86400);
      assert.ok(!error.message.includes('secret'));
      return true;
    });
  }
});

test('authorization and missing resources map to safe errors without retries', async () => {
  for (const [status, code] of [[401, 'GITHUB_ACCESS_DENIED'], [403, 'GITHUB_ACCESS_DENIED'], [404, 'REPOSITORY_NOT_FOUND']] as const) {
    let calls = 0;
    const client = new GitHubClient(undefined, fakeFetch(() => { calls++; return json({}, status); }));
    await assert.rejects(client.get('/repos/a/b', z.unknown(), signal()), { code });
    assert.equal(calls, 1);
  }
});

test('transient GET errors retry once; repeated failures stop', async () => {
  let calls = 0;
  const client = new GitHubClient(undefined, fakeFetch(() => ++calls === 1 ? json({}, 503) : json({ ok: true })));
  await client.get('/repos/a/b', z.object({ ok: z.boolean() }), signal());
  assert.equal(calls, 2);
  const unavailable = new GitHubClient(undefined, fakeFetch(() => json({}, 504)));
  await assert.rejects(unavailable.get('/repos/a/b', z.unknown(), signal()), { code: 'GITHUB_UNAVAILABLE' });
});

test('network failures, invalid payloads and oversized responses fail safely', async () => {
  const broken = new GitHubClient(undefined, fakeFetch(() => { throw new Error('sensitive transport details'); }));
  await assert.rejects(broken.get('/repos/a/b', z.unknown(), signal()), { code: 'GITHUB_UNAVAILABLE' });
  for (const response of [json({ wrong: true }), new Response('not-json'), new Response('x'.repeat(2 * 1024 * 1024 + 1))]) {
    const client = new GitHubClient(undefined, fakeFetch(() => response));
    await assert.rejects(client.get('/repos/a/b', z.object({ expected: z.string() }), signal()), { code: 'GITHUB_INVALID_RESPONSE' });
  }
});
