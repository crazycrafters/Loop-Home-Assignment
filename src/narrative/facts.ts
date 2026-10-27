import { metricDefinitions, metricKeys, methodology } from '../insights/definitions.js';
import type { InsightsService } from '../insights/service.js';

export type InsightsReport = Awaited<ReturnType<InsightsService['get']>>;
export interface Fact {
  id: string;
  value: number | null;
  unit: string;
  sampleSize: number;
  definition: string;
  evidenceIds: string[];
}

export function buildFacts(report: InsightsReport): Fact[] {
  const facts: Fact[] = [];
  for (const period of ['current', 'previous'] as const) {
    for (const key of metricKeys) {
      const metric = report[period].metrics[key];
      facts.push({ id: `${period}.${key}`, ...metricDefinitions[key], ...metric });
    }
  }
  for (const key of metricKeys) {
    const current = report.current.metrics[key];
    const previous = report.previous.metrics[key];
    const evidenceIds = [...new Set([...current.evidenceIds, ...previous.evidenceIds])];
    for (const change of ['absolute', 'relativePercent'] as const) {
      facts.push({
        id: `changes.${key}.${change}`, value: report.changes[key][change],
        unit: change === 'relativePercent' ? 'percent' : metricDefinitions[key].unit === 'percent' ? 'percentage_points' : metricDefinitions[key].unit,
        sampleSize: Math.min(current.sampleSize, previous.sampleSize), evidenceIds,
        definition: change === 'absolute' ? `Current minus previous ${key}.` : `Relative percent change of ${key}; undefined for zero baseline or missing sample.`,
      });
    }
  }
  for (const key of ['openPrCount', 'draftPrCount', 'medianAgeHours'] as const) {
    facts.push({
      id: `backlog.${key}`, value: report.currentBacklog[key],
      unit: key === 'medianAgeHours' ? 'hours' : 'pull_requests',
      sampleSize: key === 'medianAgeHours' ? report.currentBacklog.ageSampleSize : report.currentBacklog.openPrCount,
      definition: `Current backlog ${key} at collection time, not historical backlog.`,
      evidenceIds: report.currentBacklog.evidenceIds,
    });
  }
  return facts;
}

/** The model sees aggregate facts only, without repository/account names or PR bodies. */
export function buildPrompt(report: InsightsReport, facts: Fact[]) {
  return {
    periods: { current: report.current.period, previous: report.previous.period },
    sourceFetchedAt: report.source.fetchedAt,
    facts: facts.map(({ evidenceIds, ...fact }) => ({ ...fact, hasSourceEvidence: evidenceIds.length > 0 })),
    quality: { current: report.current.quality, previous: report.previous.quality },
    warnings: report.warnings,
    methodology,
  };
}
export type NarrativeInput = ReturnType<typeof buildPrompt>;
