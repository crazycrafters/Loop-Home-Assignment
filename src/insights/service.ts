import type { IngestionService } from '../github/ingestion.js';
import type { Period } from '../github/model.js';
import { metricDefinitions, methodology } from './definitions.js';
import { calculateBacklog, calculatePeriod, compareMetrics, type PeriodInsights } from './metrics.js';

interface Warning {
  code: string;
  period: 'current' | 'previous' | null;
  message: string;
}

function sampleWarnings(insights: PeriodInsights, label: 'current' | 'previous'): Warning[] {
  const warnings: Warning[] = [];
  const merged = insights.metrics.mergedPrCount.value!;
  if (merged < 5) warnings.push({ code: 'SMALL_MERGED_SAMPLE', period: label,
    message: `Only ${merged} merged PRs; avoid drawing strong conclusions from this period.` });
  if (merged > 0 && insights.metrics.reviewCount.value === 0) warnings.push({
    code: 'NO_QUALIFYING_REVIEWS', period: label,
    message: 'No identifiable non-author reviews before merge; review latency is unavailable.',
  });
  if (insights.quality.mergedPrsWithUnknownAuthor > 0) warnings.push({
    code: 'UNKNOWN_AUTHORS', period: label,
    message: 'Deleted/unknown PR authors are excluded from contributor rankings and review eligibility.',
  });
  if (insights.quality.invalidMergeDurations > 0) warnings.push({
    code: 'INVALID_MERGE_DURATIONS', period: label,
    message: 'Some merged PRs have invalid creation/merge chronology and are excluded from timing/review metrics.',
  });
  return warnings;
}

export class InsightsService {
  constructor(private readonly ingestion: IngestionService) {}

  async get(owner: string, repo: string, requested: Period) {
    const period = { from: new Date(requested.from).toISOString(), to: new Date(requested.to).toISOString() };
    const duration = Date.parse(period.to) - Date.parse(period.from);
    const previousPeriod = { from: new Date(Date.parse(period.from) - duration).toISOString(), to: period.from };
    // One collection prevents duplicate fetching and gives both cohorts the same source timestamp.
    // A 90-day requested period can therefore require a 180-day collection, under the same source limits.
    const collected = await this.ingestion.sync(owner, repo, { from: previousPeriod.from, to: period.to });
    const snapshot = collected.snapshot;
    const current = calculatePeriod(snapshot, period, 'current');
    const previous = calculatePeriod(snapshot, previousPeriod, 'previous');
    const backlog = calculateBacklog(snapshot);
    const warnings = [...sampleWarnings(current.insights, 'current'), ...sampleWarnings(previous.insights, 'previous')];
    if (Date.parse(period.to) > Date.parse(snapshot.fetchedAt)) warnings.push({
      code: 'PERIOD_NOT_COMPLETE', period: 'current',
      message: 'The requested period ends after collection time; the current period is incomplete.',
    });
    return {
      schemaVersion: '1',
      repository: snapshot.repository,
      defaultBranch: snapshot.defaultBranch,
      generatedAt: new Date().toISOString(),
      source: { fetchedAt: snapshot.fetchedAt, collectionPeriod: snapshot.period, cache: collected.cache },
      current: current.insights,
      previous: previous.insights,
      changes: compareMetrics(current.insights.metrics, previous.insights.metrics),
      currentBacklog: backlog.summary,
      evidence: [...current.evidence, ...previous.evidence, ...backlog.evidence].sort((a, b) => a.number - b.number),
      definitions: metricDefinitions,
      methodology,
      warnings,
    };
  }
}
