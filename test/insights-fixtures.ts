import type { PullRequest, Review, Snapshot } from '../src/github/model.js';
import { period } from './fixtures.js';

export function pr(number: number, overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number, url: `https://github.com/acme/project/pull/${number}`,
    author: 'Alice', state: 'closed', draft: false,
    createdAt: '2026-01-09T00:00:00Z', updatedAt: '2026-01-10T00:00:00Z',
    closedAt: '2026-01-10T00:00:00Z', mergedAt: '2026-01-10T00:00:00Z',
    additions: 8, deletions: 2, changedFiles: 1, reviews: [], ...overrides,
  };
}
export function review(id: number, author: string | null, submittedAt: string | null, state = 'APPROVED'): Review {
  return { id, author, submittedAt, state };
}
export const analyticSnapshot: Snapshot = {
  repository: 'acme/project', defaultBranch: 'main',
  period: { from: '2025-12-01T00:00:00.000Z', to: period.to },
  fetchedAt: '2026-02-02T00:00:00.000Z',
  pulls: [
    pr(1, {
      createdAt: '2025-12-31T00:00:00Z', mergedAt: period.from, closedAt: period.from,
      reviews: [
        review(11, 'Bob', '2025-12-31T06:00:00Z'),
        review(12, 'BOB', '2025-12-31T10:00:00Z', 'COMMENTED'),
        review(13, 'ALICE', '2025-12-31T01:00:00Z'),
        review(14, 'other', null, 'PENDING'),
        review(15, null, '2025-12-31T02:00:00Z'),
        review(16, 'other', '2026-01-01T01:00:00Z'),
        review(17, 'other', '2025-12-30T23:00:00Z'),
      ],
    }),
    pr(2, {
      author: 'Bob', additions: 18,
      createdAt: '2026-01-08T00:00:00Z',
      reviews: [review(21, 'Carol', '2026-01-08T12:00:00Z'), review(22, 'alice', '2026-01-08T20:00:00Z')],
    }),
    pr(3, {
      additions: 28, createdAt: '2026-01-12T00:00:00Z',
      mergedAt: '2026-01-15T00:00:00Z', closedAt: '2026-01-15T00:00:00Z',
      reviews: [review(31, 'bob', '2026-01-13T00:00:00Z', 'DISMISSED')],
    }),
    pr(4, {
      author: null, additions: 38, createdAt: '2026-01-27T00:00:00Z',
      mergedAt: '2026-01-31T00:00:00Z', closedAt: '2026-01-31T00:00:00Z',
      reviews: [review(41, 'bob', '2026-01-27T04:00:00Z')],
    }),
    pr(5, { mergedAt: null, closedAt: '2026-01-15T00:00:00Z', additions: 999 }),
    pr(6, {
      createdAt: '2025-12-26T00:00:00Z', mergedAt: '2025-12-27T00:00:00Z', closedAt: '2025-12-27T00:00:00Z',
      reviews: [review(61, 'bob', '2025-12-26T12:00:00Z')],
    }),
    pr(7, { mergedAt: period.to, closedAt: period.to }),
    pr(8, { state: 'open', draft: true, mergedAt: null, closedAt: null, createdAt: '2025-12-01T00:00:00Z' }),
    pr(9, { state: 'open', mergedAt: null, closedAt: null, createdAt: '2026-01-31T00:00:00Z' }),
  ],
};
