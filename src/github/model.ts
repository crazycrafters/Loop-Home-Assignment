import { z } from 'zod';

export const repositoryParams = z.object({
  owner: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$/),
  repo: z.string().regex(/^[a-zA-Z0-9_.-]{1,100}$/).refine(value => value !== '.' && value !== '..'),
});

export const syncBody = z.object({
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
}).strict().superRefine(({ from, to }, ctx) => {
  const duration = Date.parse(to) - Date.parse(from);
  if (duration <= 0 || duration > 90 * 86_400_000) {
    ctx.addIssue({ code: 'custom', message: 'Period must be positive and no longer than 90 days' });
  }
});

export interface Period { from: string; to: string }
export interface Review {
  id: number;
  author: string | null;
  state: string;
  submittedAt: string | null;
}
export interface PullRequest {
  number: number;
  url: string;
  author: string | null;
  state: 'open' | 'closed';
  draft: boolean;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  mergedAt: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  reviews: Review[];
}
export interface Snapshot {
  repository: string;
  defaultBranch: string;
  period: Period;
  fetchedAt: string;
  pulls: PullRequest[];
}

const timestamp = z.iso.datetime({ offset: true });
const user = z.object({ login: z.string().min(1).max(100) }).nullable();
export const metadataSchema = z.object({
  full_name: z.string().min(3).max(150),
  default_branch: z.string().min(1).max(255),
  private: z.boolean(),
});
export const pullSchema = z.object({
  number: z.number().int().positive(),
  user,
  state: z.enum(['open', 'closed']),
  draft: z.boolean(),
  created_at: timestamp,
  updated_at: timestamp,
  closed_at: timestamp.nullable(),
  merged_at: timestamp.nullable(),
  base: z.object({ ref: z.string() }),
});
export const detailSchema = pullSchema.extend({
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  changed_files: z.number().int().nonnegative(),
});
export const reviewSchema = z.object({
  id: z.number().int().positive(),
  user,
  state: z.enum(['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED', 'PENDING']),
  submitted_at: timestamp.nullable(),
});
