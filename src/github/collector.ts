import { ServiceError } from '../errors.js';
import { GitHubClient } from './client.js';
import { detailSchema, metadataSchema, pullSchema, reviewSchema, type Period, type PullRequest, type Snapshot } from './model.js';

export class GitHubCollector {
  constructor(private readonly client: GitHubClient) {}

  async collect(owner: string, repo: string, period: Period): Promise<Snapshot> {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]);
    try {
      return await this.collectSnapshot(owner, repo, period, signal);
    } finally {
      controller.abort();
    }
  }

  private async collectSnapshot(owner: string, repo: string, period: Period, signal: AbortSignal): Promise<Snapshot> {
    const root = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const { data: metadata } = await this.client.get(root, metadataSchema, signal);
    if (metadata.full_name.toLowerCase() !== `${owner}/${repo}`.toLowerCase()) {
      throw new ServiceError(502, 'GITHUB_INVALID_RESPONSE', 'GitHub returned an unexpected repository');
    }
    if (metadata.private) throw new ServiceError(403, 'PUBLIC_REPOSITORY_REQUIRED', 'Only public repositories are supported');
    const branch = encodeURIComponent(metadata.default_branch);
    const candidates = new Set<number>();
    const from = Date.parse(period.from);
    const to = Date.parse(period.to);
    const within = (value: string | null) => value !== null && Date.parse(value) >= from && Date.parse(value) < to;
    const add = (number: number) => {
      candidates.add(number);
      if (candidates.size > 200) throw new ServiceError(422, 'COLLECTION_LIMIT', 'Snapshot exceeds 200 PRs; choose a smaller repository or period');
    };
    // Open backlog is current, including PRs whose last activity predates the period.
    for await (const page of this.client.pages(`${root}/pulls?state=open&base=${branch}`, pullSchema, signal)) {
      for (const pull of page) if (pull.base.ref === metadata.default_branch) add(pull.number);
    }
    closed: for await (const page of this.client.pages(`${root}/pulls?state=closed&base=${branch}&sort=updated&direction=desc`, pullSchema, signal)) {
      for (const pull of page) {
        if (Date.parse(pull.updated_at) < from) break closed;
        if (pull.base.ref === metadata.default_branch && (within(pull.merged_at) || within(pull.closed_at))) add(pull.number);
      }
    }
    const numbers = [...candidates];
    const pulls: PullRequest[] = [];
    let next = 0;
    // Three workers bound upstream concurrency. Each PR's review pages remain sequential.
    await Promise.all(Array.from({ length: Math.min(3, numbers.length) }, async () => {
      while (next < numbers.length) {
        signal.throwIfAborted();
        const number = numbers[next++]!;
        const { data: detail } = await this.client.get(`${root}/pulls/${number}`, detailSchema, signal);
        if (detail.number !== number || detail.base.ref !== metadata.default_branch) {
          throw new ServiceError(409, 'SOURCE_CHANGED', 'PR changed during collection; retry the sync');
        }
        if (detail.state !== 'open' && !within(detail.merged_at) && !within(detail.closed_at)) continue;
        const reviews: PullRequest['reviews'] = [];
        const seenReviews = new Set<number>();
        for await (const page of this.client.pages(`${root}/pulls/${number}/reviews`, reviewSchema, signal)) {
          for (const review of page) {
            if (seenReviews.has(review.id)) continue;
            seenReviews.add(review.id);
            reviews.push({ id: review.id, author: review.user?.login ?? null, state: review.state, submittedAt: review.submitted_at });
            if (reviews.length > 1000) throw new ServiceError(422, 'COLLECTION_LIMIT', 'A PR exceeds 1000 reviews; collection was not saved');
          }
        }
        pulls.push({
          number, url: `https://github.com/${metadata.full_name}/pull/${number}`,
          author: detail.user?.login ?? null, state: detail.state, draft: detail.draft,
          createdAt: detail.created_at, updatedAt: detail.updated_at,
          closedAt: detail.closed_at, mergedAt: detail.merged_at,
          additions: detail.additions, deletions: detail.deletions, changedFiles: detail.changed_files,
          reviews: reviews.sort((a, b) => a.id - b.id),
        });
      }
    }));
    return {
      repository: metadata.full_name, defaultBranch: metadata.default_branch,
      period, fetchedAt: new Date().toISOString(), pulls: pulls.sort((a, b) => a.number - b.number),
    };
  }
}
