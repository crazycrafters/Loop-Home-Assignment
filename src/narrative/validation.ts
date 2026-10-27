import { ServiceError } from '../errors.js';
import { round } from '../insights/metrics.js';
import type { Fact, InsightsReport } from './facts.js';
import { narrativeDraftSchema, type NarrativeDraft } from './schema.js';

const invalid = () => new ServiceError(502, 'LLM_INVALID_EVIDENCE', 'Narrative citations or hypothesis did not match the calculated facts');

export function validateNarrative(value: unknown, facts: Fact[], report: InsightsReport) {
  const parsed = narrativeDraftSchema.safeParse(value);
  if (!parsed.success) throw invalid();
  const draft: NarrativeDraft = parsed.data;
  const index = new Map(facts.map(fact => [fact.id, fact]));
  const evidenceIndex = new Set(report.evidence.map(row => row.id));
  const used = new Set<string>();
  for (const claim of [...draft.observations, draft.hypothesis]) {
    const unique = new Set<string>();
    for (const ref of claim.evidence) {
      const fact = index.get(ref.factId);
      if (!fact || fact.value !== ref.value || unique.has(ref.factId) ||
          fact.evidenceIds.some(id => !evidenceIndex.has(id))) throw invalid();
      unique.add(ref.factId);
      used.add(ref.factId);
    }
  }
  const prose = [...draft.observations.map(item => item.text), draft.hypothesis.text ?? '', draft.hypothesis.rationale, ...draft.limitations];
  if (prose.some(text => /https?:\/\/|www\.|<[^>]*>|```|\]\(/i.test(text))) throw invalid();
  const support = draft.hypothesis.evidence.map(ref => index.get(ref.factId)!);
  if (draft.hypothesis.text === null) {
    if (draft.hypothesis.confidence !== 0 || support.length !== 0) throw invalid();
  } else if (report.current.metrics.mergedPrCount.value === 0 || support.length < 2 ||
      new Set(support.map(fact => fact.id.split('.')[1])).size < 2 ||
      support.some(fact => fact.value === null || fact.evidenceIds.length === 0) ||
      !support.some(fact => fact.id.startsWith('current.') || fact.id.startsWith('changes.'))) {
    throw invalid();
  }
  const minimumSample = support.length ? Math.min(...support.map(fact => fact.sampleSize)) : 0;
  let cap = minimumSample < 5 ? 0.35 : minimumSample < 10 ? 0.5 : 0.75;
  if (report.warnings.some(warning => ['PERIOD_NOT_COMPLETE', 'UNKNOWN_AUTHORS', 'INVALID_MERGE_DURATIONS'].includes(warning.code))) cap = Math.min(cap, 0.35);
  if (draft.hypothesis.text === null) cap = 0;
  return {
    draft: { ...draft, hypothesis: { ...draft.hypothesis, confidence: round(Math.min(cap, draft.hypothesis.confidence), 2) } },
    confidencePolicy: {
      scope: 'hypothesis', modelScore: draft.hypothesis.confidence, appliedCap: cap,
      minimumCitedSampleSize: minimumSample, calibrated: false,
      explanation: 'Model-assessed hypothesis plausibility, not a probability or causal finding. Capped for small cited samples and data-quality limitations.',
    },
    citedFacts: facts.filter(fact => used.has(fact.id)),
  };
}
