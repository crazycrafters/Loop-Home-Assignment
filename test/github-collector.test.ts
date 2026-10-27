import assert from 'node:assert/strict';
import test from 'node:test';
import { GitHubClient } from '../src/github/client.js';
import { GitHubCollector } from '../src/github/collector.js';
import { fakeFetch, json, metadata, period, pull, review } from './fixtures.js';

test('collects period closures and old open backlog, details and paginated reviews', async () => {
  const calls: string[] = [];
  const oldOpen = { ...pull, number: 2, state: 'open', merged_at: null, closed_at: null, updated_at: '2025-12-11T00:00:00Z' };
  const closedWithoutMerge = { ...pull, number: 3, merged_at: null, user: null };
  const client = new GitHubClient(undefined, fakeFetch(url => {
    calls.push(url.pathname + url.search);
    if (url.pathname.endsWith('/reviews')) {
      return url.searchParams.get('page') === '1'
        ? json([review], 200, { link: '<ignored>; rel="next"' })
        : json([review, { ...review, id: 13, state: 'COMMENTED', user: null }]);
    }
    const number = Number(url.pathname.split('/').at(-1));
    if (number) return json(number === 2 ? oldOpen : number === 3 ? closedWithoutMerge : pull);
    if (url.pathname.endsWith('/pulls')) {
      assert.equal(url.searchParams.get('base'), 'main');
      if (url.searchParams.get('state') === 'open') return json([oldOpen]);
      return json([
        { ...pull, number: 4, merged_at: period.to, closed_at: period.to, updated_at: period.to },
        { ...closedWithoutMerge, merged_at: null, closed_at: period.from },
        pull,
        { ...pull, number: 5, updated_at: '2025-12-30T00:00:00Z' },
      ], 200, { link: '<ignored>; rel="next"' });
    }
    return json(metadata);
  }));
  const result = await new GitHubCollector(client).collect('acme', 'project', period);
  assert.deepEqual(result.pulls.map(p => p.number), [1, 2, 3]);
  assert.equal(result.pulls[0]!.additions, 10);
  assert.equal(result.pulls[0]!.url, 'https://github.com/acme/project/pull/1');
  assert.equal(result.pulls[2]!.author, null);
  assert.equal(result.pulls[0]!.reviews.length, 2);
  assert.equal(result.pulls[0]!.reviews[1]!.author, null);
  assert.ok(!calls.some(path => path.includes('state=closed') && path.includes('page=2')));
});

test('rejects private or mismatched repository metadata before fetching PRs', async () => {
  for (const [data, code] of [[{ ...metadata, private: true }, 'PUBLIC_REPOSITORY_REQUIRED'],
    [{ ...metadata, full_name: 'other/project' }, 'GITHUB_INVALID_RESPONSE']] as const) {
    let calls = 0;
    const client = new GitHubClient(undefined, fakeFetch(() => { calls++; return json(data); }));
    await assert.rejects(new GitHubCollector(client).collect('acme', 'project', period), { code });
    assert.equal(calls, 1);
  }
});

test('bounded concurrency is three requests while fetching PR details', async () => {
  let active = 0;
  let maximum = 0;
  const client = new GitHubClient(undefined, fakeFetch(async url => {
    if (url.pathname.endsWith('/reviews')) return json([]);
    const number = Number(url.pathname.split('/').at(-1));
    if (number) {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 10));
      active--;
      return json({ ...pull, number });
    }
    if (url.pathname.endsWith('/pulls')) return json(url.searchParams.get('state') === 'open' ? [] :
      Array.from({ length: 10 }, (_, i) => ({ ...pull, number: i + 1 })));
    return json(metadata);
  }));
  assert.equal((await new GitHubCollector(client).collect('acme', 'project', period)).pulls.length, 10);
  assert.equal(maximum, 3);
});

test('collection limit rejects before fetching details', async () => {
  const client = new GitHubClient(undefined, fakeFetch(url => {
    if (!url.pathname.endsWith('/pulls')) return json(metadata);
    const page = Number(url.searchParams.get('page'));
    return json(Array.from({ length: 100 }, (_, i) => ({ ...pull, number: (page - 1) * 100 + i + 1 })),
      200, { link: '<ignored>; rel="next"' });
  }));
  await assert.rejects(new GitHubCollector(client).collect('acme', 'project', period), { code: 'COLLECTION_LIMIT' });
});

test('PR base changes during collection return a retryable conflict', async () => {
  const client = new GitHubClient(undefined, fakeFetch(url => {
    if (url.pathname.endsWith('/1')) return json({ ...pull, base: { ref: 'other' } });
    if (url.pathname.endsWith('/pulls')) return json(url.searchParams.get('state') === 'open' ? [] : [pull]);
    return json(metadata);
  }));
  await assert.rejects(new GitHubCollector(client).collect('acme', 'project', period), { code: 'SOURCE_CHANGED' });
});

test('oversized review histories fail instead of silently omitting reviews', async () => {
  const client = new GitHubClient(undefined, fakeFetch(url => {
    if (url.pathname.endsWith('/reviews')) {
      const page = Number(url.searchParams.get('page'));
      return json(Array.from({ length: 100 }, (_, i) => ({ ...review, id: (page - 1) * 100 + i + 1 })),
        200, { link: '<ignored>; rel="next"' });
    }
    if (url.pathname.endsWith('/1')) return json(pull);
    if (url.pathname.endsWith('/pulls')) return json(url.searchParams.get('state') === 'open' ? [] : [pull]);
    return json(metadata);
  }));
  await assert.rejects(new GitHubCollector(client).collect('acme', 'project', period), { code: 'COLLECTION_LIMIT' });
});
