import type { Period, PullRequest, Snapshot } from '../github/model.js';
import { metricKeys, type MetricKey } from './definitions.js';

export interface Metric {
  value: number | null;
  sampleSize: number;
  evidenceIds: string[];
}
export type Metrics = Record<MetricKey, Metric>;
export interface ReviewEvidence {
  id: number;
  author: string;
  state: string;
  submittedAt: string;
  url: string;
}
export interface PullEvidence {
  id: string;
  cohort: 'current' | 'previous' | 'backlog';
  number: number;
  url: string;
  author: string | null;
  draft: boolean;
  createdAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  changedLines: number;
  mergeHours: number | null;
  firstReviewHours: number | null;
  postFirstReviewHours: number | null;
  firstReviewId: number | null;
  ageHours: number | null;
  reviews: ReviewEvidence[];
}
export interface Quality {
  mergedPrsWithUnknownAuthor: number;
  invalidMergeDurations: number;
  excludedReviews: {
    pendingOrUnsubmitted: number;
    unknownIdentity: number;
    selfReview: number;
    outsideLifecycle: number;
    unsupportedState: number;
  };
}
interface Contributor { login: string; mergedPrCount: number; changedLines: number; evidenceIds: string[] }
interface Reviewer { login: string; reviewCount: number; reviewedPrCount: number; sharePercent: number; evidenceIds: string[] }
export interface PeriodInsights {
  period: Period;
  metrics: Metrics;
  contributors: Contributor[];
  reviewers: Reviewer[];
  quality: Quality;
}

const hour = 3_600_000;
const eligibleStates = new Set(['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED']);
const known = (identity: string | null): identity is string => identity !== null && identity.length > 0;
const account = (identity: string) => identity.toLowerCase();
const id = (pull: PullRequest) => `pr-${pull.number}`;
export const round = (value: number, digits = 6) => Number(value.toFixed(digits)) || 0;
const compareLogin = (a: { login: string }, b: { login: string }) => a.login < b.login ? -1 : a.login > b.login ? 1 : 0;
const within = (value: string | null, period: Period) => value !== null &&
  Date.parse(value) >= Date.parse(period.from) && Date.parse(value) < Date.parse(period.to);

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return round(sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2);
}

function count(rows: PullEvidence[], value = rows.length): Metric {
  return { value, sampleSize: value, evidenceIds: rows.map(row => row.id) };
}
function percentage(numerator: number, denominator: number, rows: PullEvidence[]): Metric {
  return { value: denominator ? round(100 * numerator / denominator, 2) : null,
    sampleSize: denominator, evidenceIds: rows.map(row => row.id) };
}
function duration(rows: { row: PullEvidence; value: number }[]): Metric {
  return { value: median(rows.map(sample => sample.value)), sampleSize: rows.length,
    evidenceIds: rows.map(sample => sample.row.id) };
}

export function calculatePeriod(snapshot: Snapshot, period: Period, cohort: 'current' | 'previous'):
  { insights: PeriodInsights; evidence: PullEvidence[] } {
  const evidence: PullEvidence[] = [];
  const merged: PullEvidence[] = [];
  const unmerged: PullEvidence[] = [];
  const mergeDurations: { row: PullEvidence; value: number }[] = [];
  const firstDurations: { row: PullEvidence; value: number }[] = [];
  const postDurations: { row: PullEvidence; value: number }[] = [];
  const contributors = new Map<string, Contributor>();
  const reviewers = new Map<string, { login: string; reviewCount: number; prs: Set<string> }>();
  const quality: Quality = {
    mergedPrsWithUnknownAuthor: 0, invalidMergeDurations: 0,
    excludedReviews: { pendingOrUnsubmitted: 0, unknownIdentity: 0, selfReview: 0, outsideLifecycle: 0, unsupportedState: 0 },
  };
  let reviewCount = 0;
  for (const pull of [...snapshot.pulls].sort((a, b) => a.number - b.number)) {
    const isMerged = pull.state === 'closed' && within(pull.mergedAt, period);
    const isUnmerged = pull.state === 'closed' && pull.mergedAt === null && within(pull.closedAt, period);
    if (!isMerged && !isUnmerged) continue;
    const row: PullEvidence = {
      id: id(pull), cohort, number: pull.number, url: pull.url, author: pull.author,
      draft: pull.draft, createdAt: pull.createdAt, mergedAt: pull.mergedAt, closedAt: pull.closedAt,
      changedLines: pull.additions + pull.deletions,
      mergeHours: null, firstReviewHours: null, postFirstReviewHours: null, firstReviewId: null,
      ageHours: null, reviews: [],
    };
    evidence.push(row);
    if (isUnmerged) { unmerged.push(row); continue; }
    merged.push(row);
    if (known(pull.author)) {
      const login = account(pull.author);
      const contributor = contributors.get(login) ?? { login, mergedPrCount: 0, changedLines: 0, evidenceIds: [] };
      contributor.mergedPrCount++;
      contributor.changedLines += row.changedLines;
      contributor.evidenceIds.push(row.id);
      contributors.set(login, contributor);
    } else quality.mergedPrsWithUnknownAuthor++;
    const created = Date.parse(pull.createdAt);
    const mergedAt = Date.parse(pull.mergedAt!);
    if (!Number.isFinite(created) || !Number.isFinite(mergedAt) || mergedAt < created) {
      quality.invalidMergeDurations++;
      continue;
    }
    const mergeHours = (mergedAt - created) / hour;
    row.mergeHours = round(mergeHours);
    mergeDurations.push({ row, value: mergeHours });
    let first: ReviewEvidence | undefined;
    const seen = new Set<number>();
    for (const review of pull.reviews) {
      if (seen.has(review.id)) continue;
      seen.add(review.id);
      if (review.state === 'PENDING' || review.submittedAt === null) {
        quality.excludedReviews.pendingOrUnsubmitted++; continue;
      }
      if (!eligibleStates.has(review.state)) { quality.excludedReviews.unsupportedState++; continue; }
      if (!known(pull.author) || !known(review.author)) { quality.excludedReviews.unknownIdentity++; continue; }
      if (account(pull.author) === account(review.author)) { quality.excludedReviews.selfReview++; continue; }
      const submitted = Date.parse(review.submittedAt);
      if (!Number.isFinite(submitted) || submitted < created || submitted > mergedAt) {
        quality.excludedReviews.outsideLifecycle++; continue;
      }
      const login = account(review.author);
      const item: ReviewEvidence = {
        id: review.id, author: login, state: review.state, submittedAt: review.submittedAt,
        url: `${pull.url}#pullrequestreview-${review.id}`,
      };
      row.reviews.push(item);
      if (!first || submitted < Date.parse(first.submittedAt) ||
          (submitted === Date.parse(first.submittedAt) && review.id < first.id)) first = item;
      const reviewer = reviewers.get(login) ?? { login, reviewCount: 0, prs: new Set<string>() };
      reviewer.reviewCount++;
      reviewer.prs.add(row.id);
      reviewers.set(login, reviewer);
      reviewCount++;
    }
    row.reviews.sort((a, b) => a.id - b.id);
    if (first) {
      const firstHours = (Date.parse(first.submittedAt) - created) / hour;
      const postHours = (mergedAt - Date.parse(first.submittedAt)) / hour;
      row.firstReviewId = first.id;
      row.firstReviewHours = round(firstHours);
      row.postFirstReviewHours = round(postHours);
      firstDurations.push({ row, value: firstHours });
      postDurations.push({ row, value: postHours });
    }
  }
  const reviewed = merged.filter(row => row.reviews.length > 0);
  const contributorList = [...contributors.values()].sort((a, b) => b.mergedPrCount - a.mergedPrCount || compareLogin(a, b));
  const reviewerList: Reviewer[] = [...reviewers.values()].map(reviewer => ({
    login: reviewer.login, reviewCount: reviewer.reviewCount,
    reviewedPrCount: reviewer.prs.size, sharePercent: round(100 * reviewer.reviewCount / reviewCount, 2),
    evidenceIds: [...reviewer.prs],
  })).sort((a, b) => b.reviewCount - a.reviewCount || compareLogin(a, b));
  const metrics: Metrics = {
    mergedPrCount: count(merged),
    closedWithoutMergeCount: count(unmerged),
    closedWithoutMergeRatePercent: percentage(unmerged.length, merged.length + unmerged.length, evidence),
    medianMergeHours: duration(mergeDurations),
    medianFirstReviewHours: duration(firstDurations),
    medianPostFirstReviewHours: duration(postDurations),
    medianChangedLines: { value: median(merged.map(row => row.changedLines)), sampleSize: merged.length, evidenceIds: merged.map(row => row.id) },
    reviewedMergedPrPercent: percentage(reviewed.length, merged.length, merged),
    reviewCount: count(reviewed, reviewCount),
    distinctReviewers: count(reviewed, reviewers.size),
    topReviewerSharePercent: percentage(reviewerList[0]?.reviewCount ?? 0, reviewCount, reviewed),
  };
  return { insights: { period, metrics, contributors: contributorList, reviewers: reviewerList, quality }, evidence };
}

export function calculateBacklog(snapshot: Snapshot) {
  const fetchedAt = Date.parse(snapshot.fetchedAt);
  const evidence: PullEvidence[] = snapshot.pulls.filter(pull => pull.state === 'open').sort((a, b) => a.number - b.number).map(pull => {
    const age = (fetchedAt - Date.parse(pull.createdAt)) / hour;
    return {
      id: id(pull), cohort: 'backlog', number: pull.number, url: pull.url, author: pull.author,
      draft: pull.draft, createdAt: pull.createdAt, mergedAt: pull.mergedAt, closedAt: pull.closedAt,
      changedLines: pull.additions + pull.deletions,
      mergeHours: null, firstReviewHours: null, postFirstReviewHours: null, firstReviewId: null,
      ageHours: Number.isFinite(age) && age >= 0 ? round(age) : null, reviews: [],
    };
  });
  return {
    summary: {
      asOf: snapshot.fetchedAt, openPrCount: evidence.length,
      draftPrCount: evidence.filter(row => row.draft).length,
      medianAgeHours: median(evidence.flatMap(row => row.ageHours === null ? [] : [(fetchedAt - Date.parse(row.createdAt)) / hour])),
      ageSampleSize: evidence.filter(row => row.ageHours !== null).length,
      evidenceIds: evidence.map(row => row.id),
    },
    evidence,
  };
}

export function compareMetrics(current: Metrics, previous: Metrics) {
  return Object.fromEntries(metricKeys.map(key => {
    const now = current[key].value;
    const before = previous[key].value;
    const missing = now === null || before === null;
    return [key, {
      absolute: missing ? null : round(now - before),
      relativePercent: missing || before === 0 ? null : round(100 * (now - before) / before, 2),
      unavailableReason: missing ? 'MISSING_SAMPLE' : before === 0 ? 'ZERO_BASELINE' : null,
    }];
  })) as Record<MetricKey, { absolute: number | null; relativePercent: number | null; unavailableReason: 'MISSING_SAMPLE' | 'ZERO_BASELINE' | null }>;
}
