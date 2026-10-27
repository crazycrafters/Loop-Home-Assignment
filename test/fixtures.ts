import type { Fetch } from '../src/github/client.js';
import type { Snapshot } from '../src/github/model.js';

export const period = { from: '2026-01-01T00:00:00.000Z', to: '2026-02-01T00:00:00.000Z' };
export const metadata = { full_name: 'acme/project', default_branch: 'main', private: false };
export const pull = {
  number: 1, user: { login: 'author' }, state: 'closed', draft: false,
  created_at: '2025-12-10T00:00:00Z', updated_at: '2026-01-15T00:00:00Z',
  closed_at: '2026-01-15T00:00:00Z', merged_at: '2026-01-15T00:00:00Z',
  base: { ref: 'main' }, additions: 10, deletions: 2, changed_files: 1,
};
export const review = {
  id: 12, user: { login: 'reviewer' }, state: 'APPROVED', submitted_at: '2026-01-14T00:00:00Z',
};
export const snapshot: Snapshot = {
  repository: 'acme/project', defaultBranch: 'main', period,
  fetchedAt: '2026-02-02T00:00:00.000Z', pulls: [],
};

export function fakeFetch(handler: (url: URL, init?: RequestInit) => Response | Promise<Response>): Fetch {
  return (async (input, init) => handler(new URL(String(input)), init)) as Fetch;
}

export function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });
}
