import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateBacklog, calculatePeriod, compareMetrics, median } from '../src/insights/metrics.js';
import { metricKeys } from '../src/insights/definitions.js';
import { period } from './fixtures.js';
import { analyticSnapshot, pr, review } from './insights-fixtures.js';

const current = () => calculatePeriod(analyticSnapshot, period, 'current');
const previousPeriod = { from: '2025-12-01T00:00:00.000Z', to: period.from };

test('delivery and review metrics match a hand-calculated cohort', () => {
  const { insights, evidence } = current();
  const m = insights.metrics;
  assert.equal(m.mergedPrCount.value, 4);
  assert.equal(m.closedWithoutMergeCount.value, 1);
  assert.equal(m.closedWithoutMergeRatePercent.value, 20);
  assert.equal(m.medianMergeHours.value, 60); // median(24, 48, 72, 96)
  assert.equal(m.medianFirstReviewHours.value, 12); // median(6, 12, 24)
  assert.equal(m.medianPostFirstReviewHours.value, 36); // median(18, 36, 48)
  assert.equal(m.medianChangedLines.value, 25); // median(10, 20, 30, 40)
  assert.equal(m.reviewedMergedPrPercent.value, 75);
  assert.equal(m.reviewCount.value, 5);
  assert.equal(m.distinctReviewers.value, 3);
  assert.equal(m.topReviewerSharePercent.value, 60);
  assert.equal(m.medianMergeHours.sampleSize, 4);
  assert.equal(m.medianFirstReviewHours.sampleSize, 3);
  assert.equal(m.reviewedMergedPrPercent.sampleSize, 4);
  assert.deepEqual(evidence.map(row => row.number), [1, 2, 3, 4, 5]);
  assert.equal(evidence[0]!.firstReviewId, 11);
  // PR #1 merged exactly at from; its December reviews belong to this merged cohort.
  assert.equal(evidence[0]!.reviews[0]!.submittedAt, '2025-12-31T06:00:00Z');
});

test('review eligibility excludes self, pending, unknown and out-of-lifecycle reviews', () => {
  const { insights, evidence } = current();
  assert.deepEqual(insights.quality, {
    mergedPrsWithUnknownAuthor: 1, invalidMergeDurations: 0,
    excludedReviews: { pendingOrUnsubmitted: 1, unknownIdentity: 2, selfReview: 1, outsideLifecycle: 2, unsupportedState: 0 },
  });
  assert.equal(evidence.find(row => row.number === 3)!.reviews[0]!.state, 'DISMISSED');
  assert.equal(evidence.find(row => row.number === 4)!.firstReviewHours, null);
  assert.ok(evidence.every(row => row.reviews.every(item => item.url.endsWith(`#pullrequestreview-${item.id}`))));
});

test('rankings normalize identities, distinguish repeat reviews from reviewed PRs, and retain unknown authors in totals', () => {
  const { insights } = current();
  assert.deepEqual(insights.contributors, [
    { login: 'alice', mergedPrCount: 2, changedLines: 40, evidenceIds: ['pr-1', 'pr-3'] },
    { login: 'bob', mergedPrCount: 1, changedLines: 20, evidenceIds: ['pr-2'] },
  ]);
  assert.deepEqual(insights.reviewers, [
    { login: 'bob', reviewCount: 3, reviewedPrCount: 2, sharePercent: 60, evidenceIds: ['pr-1', 'pr-3'] },
    { login: 'alice', reviewCount: 1, reviewedPrCount: 1, sharePercent: 20, evidenceIds: ['pr-2'] },
    { login: 'carol', reviewCount: 1, reviewedPrCount: 1, sharePercent: 20, evidenceIds: ['pr-2'] },
  ]);
  assert.equal(insights.contributors.reduce((sum, row) => sum + row.mergedPrCount, 0) +
    insights.quality.mergedPrsWithUnknownAuthor, insights.metrics.mergedPrCount.value);
});

test('every metric and leaderboard evidence reference resolves and review totals reconcile', () => {
  const { insights, evidence } = current();
  const index = new Map(evidence.map(row => [row.id, row]));
  for (const metric of Object.values(insights.metrics)) {
    for (const evidenceId of metric.evidenceIds) assert.ok(index.has(evidenceId));
  }
  for (const row of [...insights.contributors, ...insights.reviewers]) {
    for (const evidenceId of row.evidenceIds) assert.ok(index.has(evidenceId));
  }
  assert.equal(evidence.reduce((sum, row) => sum + row.reviews.length, 0), insights.metrics.reviewCount.value);
  assert.equal(insights.reviewers.reduce((sum, row) => sum + row.reviewCount, 0), insights.metrics.reviewCount.value);
});

test('half-open cohorts and current backlog remain disjoint', () => {
  const now = current();
  const before = calculatePeriod(analyticSnapshot, previousPeriod, 'previous');
  assert.deepEqual(before.evidence.map(row => row.number), [6]);
  const backlog = calculateBacklog(analyticSnapshot);
  assert.deepEqual(backlog.summary, {
    asOf: analyticSnapshot.fetchedAt, openPrCount: 2, draftPrCount: 1,
    medianAgeHours: 780, ageSampleSize: 2, evidenceIds: ['pr-8', 'pr-9'],
  });
  const ids = [...now.evidence, ...before.evidence, ...backlog.evidence].map(row => row.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(!ids.includes('pr-7')); // merged exactly at to
});

test('empty datasets yield zero counts and null medians/percentages rather than invented zero latencies', () => {
  const { insights } = calculatePeriod({ ...analyticSnapshot, pulls: [] }, period, 'current');
  for (const key of metricKeys) {
    assert.equal(insights.metrics[key].sampleSize, 0);
    assert.deepEqual(insights.metrics[key].evidenceIds, []);
  }
  assert.equal(insights.metrics.mergedPrCount.value, 0);
  assert.equal(insights.metrics.reviewCount.value, 0);
  assert.equal(insights.metrics.medianMergeHours.value, null);
  assert.equal(insights.metrics.medianFirstReviewHours.value, null);
  assert.equal(insights.metrics.closedWithoutMergeRatePercent.value, null);
  assert.equal(insights.metrics.reviewedMergedPrPercent.value, null);
  assert.equal(insights.metrics.topReviewerSharePercent.value, null);
  assert.equal(calculateBacklog({ ...analyticSnapshot, pulls: [] }).summary.medianAgeHours, null);
});

test('baseline comparisons distinguish relative changes, percentage points, zero baselines, and missing samples', () => {
  const now = current().insights.metrics;
  const before = calculatePeriod(analyticSnapshot, previousPeriod, 'previous').insights.metrics;
  const changes = compareMetrics(now, before);
  assert.deepEqual(changes.mergedPrCount, { absolute: 3, relativePercent: 300, unavailableReason: null });
  assert.deepEqual(changes.medianMergeHours, { absolute: 36, relativePercent: 150, unavailableReason: null });
  assert.deepEqual(changes.reviewedMergedPrPercent, { absolute: -25, relativePercent: -25, unavailableReason: null });
  assert.deepEqual(changes.closedWithoutMergeRatePercent, { absolute: 20, relativePercent: null, unavailableReason: 'ZERO_BASELINE' });
  const empty = calculatePeriod({ ...analyticSnapshot, pulls: [] }, period, 'previous').insights.metrics;
  assert.deepEqual(compareMetrics(now, empty).medianMergeHours,
    { absolute: null, relativePercent: null, unavailableReason: 'MISSING_SAMPLE' });
});

test('invalid merge chronology and future backlog timestamps do not create negative durations', () => {
  const snapshot = { ...analyticSnapshot, pulls: [
    pr(1, { createdAt: '2026-01-11T00:00:00Z', reviews: [review(1, 'bob', '2026-01-09T00:00:00Z')] }),
    pr(2, { state: 'open', mergedAt: null, closedAt: null, createdAt: '2026-03-01T00:00:00Z' }),
  ] };
  const result = calculatePeriod(snapshot, period, 'current');
  assert.equal(result.insights.metrics.mergedPrCount.value, 1);
  assert.equal(result.insights.metrics.medianMergeHours.value, null);
  assert.equal(result.insights.quality.invalidMergeDurations, 1);
  assert.equal(calculateBacklog(snapshot).summary.medianAgeHours, null);
  assert.equal(calculateBacklog(snapshot).summary.ageSampleSize, 0);
});

test('reviews exactly at creation and merge qualify, duplicates do not count twice', () => {
  const snapshot = { ...analyticSnapshot, pulls: [pr(1, { reviews: [
    review(2, 'bob', '2026-01-10T00:00:00Z'),
    review(1, 'bob', '2026-01-09T00:00:00Z'),
    review(1, 'bob', '2026-01-09T00:00:00Z'),
    review(3, 'bob', '2026-01-09T01:00:00Z', 'UNSUPPORTED'),
  ] })] };
  const result = calculatePeriod(snapshot, period, 'current');
  assert.equal(result.insights.metrics.reviewCount.value, 2);
  assert.equal(result.insights.metrics.medianFirstReviewHours.value, 0);
  assert.equal(result.insights.metrics.medianPostFirstReviewHours.value, 24);
  assert.equal(result.insights.quality.excludedReviews.unsupportedState, 1);
});

test('results are deterministic and calculations do not mutate source arrays', () => {
  const original = structuredClone(analyticSnapshot);
  const shuffled = { ...analyticSnapshot, pulls: [...analyticSnapshot.pulls].reverse().map(pull => ({
    ...pull, reviews: [...pull.reviews].reverse(),
  })) };
  assert.deepEqual(calculatePeriod(shuffled, period, 'current'), current());
  assert.deepEqual(analyticSnapshot, original);
  const numbers = [9, 1, 4, 2];
  assert.equal(median(numbers), 3);
  assert.deepEqual(numbers, [9, 1, 4, 2]);
});
