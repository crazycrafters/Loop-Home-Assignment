# Delivery and review insights

`GET /api/repos/{owner}/{repo}/insights?from=<timestamp>&to=<timestamp>`

## Why these metrics

PR throughput alone cannot distinguish quick delivery from a buildup of slow work.
Creation-to-merge time shows elapsed delivery time; first-review time and the time
remaining after review help locate where that time was spent. Review coverage and
sample sizes help reveal selection bias in the timing metrics. Change size and
review concentration add context for investigating a slowdown without claiming to
prove its cause. Contributor/reviewer tables make the aggregates inspectable,
not a ranking of employee productivity. Automation accounts are included.

## Periods and source data

Pass exactly `from` and `to` as ISO-8601 timestamps with a timezone. The period must
be positive and no longer than 90 elapsed days. Both periods are half-open UTC
intervals. The baseline is the immediately preceding **equal elapsed duration**,
not the previous calendar month. For example, August 1–September 1 compares with
July 1–August 1. Offset/DST boundaries preserve elapsed duration.

The service collects a single snapshot covering the union of both periods. This
can span 180 days for a 90-day request. The existing 200-PR, pagination, and payload
limits apply to the whole collection, including the current open backlog. An
upstream error or exceeded limit fails the request; it does not return a successful
response with incomplete numbers. Identical combined periods reuse the SQLite
snapshot for the configured TTL.

Both cohorts use the repository's current default branch. Open backlog is collected
separately and describes `source.fetchedAt`, even for a historical query. It never
contributes to either period's merged-PR metrics. GitHub reads are not atomic, and
current PR/draft/review state does not reconstruct every historical state transition.

## Metric definitions

Every metric has `{ value, sampleSize, evidenceIds }`. The API returns the full
`definitions` and `methodology` alongside the results.

| Metric | Meaning and population |
| --- | --- |
| `mergedPrCount` | PRs merged into the default branch during the period |
| `closedWithoutMergeCount` | Currently closed, unmerged PRs closed during the period; reopened PRs are not counted as historical closure events |
| `closedWithoutMergeRatePercent` | Unmerged closures divided by merged PRs plus unmerged closures, × 100 |
| `medianMergeHours` | Median creation-to-merge elapsed hours for the merged cohort, including draft time |
| `medianFirstReviewHours` | Median creation-to-first-qualifying-review hours among reviewed PRs in the merged cohort |
| `medianPostFirstReviewHours` | Median first-review-to-merge hours among that same reviewed cohort |
| `medianChangedLines` | Median additions + deletions for the merged cohort |
| `reviewedMergedPrPercent` | Merged PRs with an identifiable qualifying review divided by all merged PRs, × 100 |
| `reviewCount` | Qualifying review submissions on the merged cohort, including submissions before the period |
| `distinctReviewers` | Distinct case-normalized qualifying reviewer accounts |
| `topReviewerSharePercent` | Largest individual's qualifying-review count divided by total qualifying reviews, × 100 |

A qualifying review has a known reviewer and known PR author who differ ignoring
case. It has a submission timestamp at or after creation and at or before merge,
and state APPROVED, CHANGES_REQUESTED, COMMENTED, or DISMISSED. Pending/unsubmitted,
self, unidentified, and out-of-lifecycle reviews do not qualify. A dismissed
submitted review still establishes participation and first-review timing; its
original decision is not reconstructed. Review records count submissions, not
individual line comments or conversation comments.

**These are merged-cohort review metrics, not all reviews submitted across the
repository during the period.** A PR created in December, reviewed in December,
and merged in January contributes its reviews and latency to January's cohort.
Draft time is included because ready-for-review transitions are not collected.

Contributor tables rank by merged count, with alphabetical ties. Each entry has
merged count, changed lines, and evidence references. Unknown authors remain in
overall counts/size metrics but are excluded from contributor rankings and review
eligibility. Reviewer tables rank by qualifying submissions, also report distinct
reviewed PRs, and count repeated submissions on one PR separately. Login identity
is case-normalized; bots are not filtered or labeled as people.

## Missing data and comparisons

Counts are zero on an empty cohort. Empty medians and percentages with a zero
denominator are `null`. Unreviewed PRs never become zero-hour review samples.
`sampleSize` is the number of observations for a count/median or the denominator
of a percentage. Negative/invalid creation-to-merge durations are excluded from
timing and review calculations and surfaced in `quality`.

For each metric, `changes` contains:

- `absolute`: current minus previous, in the metric unit. Percent metrics use
  **percentage points**, so 50% → 75% has an absolute change of 25.
- `relativePercent`: 100 × (current − previous) / previous. The same example is 50%.
- `unavailableReason`: `ZERO_BASELINE` when the previous value is zero,
  `MISSING_SAMPLE` when either value is null, otherwise null.

An absolute change may still exist with `ZERO_BASELINE`; relative growth does not.
Elapsed hours use calendar time, not business hours, and round to six decimals;
percentages round to two. Medians use the unrounded source durations. Medians for
different distributions do not add up, so do not add the first-review median and
post-review median to recover the overall merge-time median.

Warnings identify fewer than five merged PRs or reviewed timing samples, missing
qualifying reviews, unknown authors, invalid chronology, and a period ending after
source collection. These warnings are descriptive heuristics, not statistical
confidence scores. Review-state exclusions appear in each cohort's `quality`.

## Evidence and response layout

`current` and `previous` each contain `period`, `metrics`, `contributors`,
`reviewers`, and `quality`. `changes` compares their scalar metrics.
`currentBacklog` contains open/draft counts, median age, an age sample count,
`asOf`, and evidence references. `source` identifies the combined collection
period, fetched time, and cache hit/freshness configuration. `generatedAt` describes
response generation and must not be mistaken for source freshness.

The shared `evidence` array holds every selected PR, identified by `pr-<number>`.
Each row contains its cohort, source URL, author, lifecycle timestamps, changed
lines, derived durations, first-review ID, and all qualifying review records with
GitHub review permalinks. Backlog rows also have age at collection time; their
review arrays are empty because this endpoint makes no backlog-review claim.
Follow any metric/table `evidenceIds` to these rows to reproduce its calculation.
A first review links directly to the record establishing its timestamp.

For example, `medianMergeHours.evidenceIds` selects the PR creation/merge pairs
whose elapsed hours determine that median. `reviewCount.evidenceIds` selects PR
rows whose `reviews.length` sums to the count. Source URLs let a reviewer compare
these records with GitHub. Evidence spans both periods without assigning one PR
to multiple cohorts.

## Interpreting results

A larger merge-time median alongside a larger first-review median is a reason to
investigate waiting for review. It does not establish that review capacity caused
the slowdown. Check coverage, cohort size, change sizes, draft time, and source
limitations before comparing periods. More lines or reviews do not imply better
individual performance. The narrative endpoint uses these facts and evidence to produce explicitly
qualified LLM hypotheses.
