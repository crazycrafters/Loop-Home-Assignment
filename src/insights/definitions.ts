/** Definitions are returned with every response so metric populations remain explicit. */
export const metricDefinitions = {
  mergedPrCount: {
    unit: 'pull_requests',
    definition: 'PRs targeting the default branch with mergedAt in [from, to).',
  },
  closedWithoutMergeCount: {
    unit: 'pull_requests',
    definition: 'Currently closed, unmerged PRs with closedAt in [from, to). Reopened PRs are not historical closure events.',
  },
  closedWithoutMergeRatePercent: {
    unit: 'percent',
    definition: '100 × closedWithoutMergeCount / (mergedPrCount + closedWithoutMergeCount).',
  },
  medianMergeHours: {
    unit: 'hours',
    definition: 'Median elapsed creation-to-merge time for PRs merged in the period. Includes time spent in draft.',
  },
  medianFirstReviewHours: {
    unit: 'hours',
    definition: 'Median creation-to-first-qualifying-review time for reviewed PRs merged in the period. Unreviewed PRs are excluded, not zero.',
  },
  medianPostFirstReviewHours: {
    unit: 'hours',
    definition: 'Median first-qualifying-review-to-merge time, for the same reviewed cohort. Medians are not additive.',
  },
  medianChangedLines: {
    unit: 'lines',
    definition: 'Median additions + deletions for PRs merged in the period. Change volume is not a measure of productivity.',
  },
  reviewedMergedPrPercent: {
    unit: 'percent',
    definition: '100 × merged PRs with at least one qualifying review / mergedPrCount. Unknown identities may understate coverage.',
  },
  reviewCount: {
    unit: 'reviews',
    definition: 'Qualifying reviews on the merged cohort, including reviews submitted before the period. Not repository-wide reviews submitted during the period.',
  },
  distinctReviewers: {
    unit: 'accounts',
    definition: 'Distinct case-normalized accounts submitting qualifying reviews on the merged cohort, including automation accounts.',
  },
  topReviewerSharePercent: {
    unit: 'percent',
    definition: '100 × the largest individual qualifying-review count / reviewCount. Repeat reviews on one PR each count.',
  },
} as const;

export type MetricKey = keyof typeof metricDefinitions;
export const metricKeys = Object.keys(metricDefinitions) as MetricKey[];

export const methodology = {
  interval: 'Half-open UTC periods: from inclusive, to exclusive. Baseline is the immediately preceding equal-duration period.',
  reviewEligibility: 'Known PR author and reviewer, different accounts ignoring case, submitted at or after creation and at or before merge. APPROVED, CHANGES_REQUESTED, COMMENTED, and DISMISSED count; pending/unsubmitted reviews do not.',
  reviewState: 'Review state is current, not its historical value at merge. Dismissed submitted reviews still establish participation and first-review timing.',
  samples: 'sampleSize is the number of observations entering a median/count or the denominator of a percentage. Empty medians and zero-denominator percentages are null.',
  comparison: 'absolute is current minus previous in the metric unit (percentage points for percent metrics). relativePercent is 100 × absolute / previous, null for a zero baseline or missing sample.',
  precision: 'Elapsed time uses calendar hours, not business hours. Hours and absolute changes round to 6 decimals; percentages round to 2. Medians use unrounded durations.',
  evidence: 'Evidence contains every selected PR and every qualifying merged-cohort review. Metric and leaderboard evidenceIds refer to PR evidence IDs.',
  limitations: [
    'Current open backlog is measured at fetchedAt, not at either period boundary.',
    'GitHub reads are not atomic. Current branch, PR state, and review state cannot reconstruct all historical transitions.',
    'Draft wait time and automation accounts are included. These metrics do not rank individual productivity or establish causes.',
    'Review latency excludes PRs without an identifiable qualifying review; compare coverage and sample sizes before drawing conclusions.',
  ],
} as const;
