import { IngestionService } from '../src/github/ingestion.js';
import type { Snapshot } from '../src/github/model.js';
import { InsightsService } from '../src/insights/service.js';
import type { NarrativeDraft } from '../src/narrative/schema.js';
import { analyticSnapshot } from './insights-fixtures.js';

export function fixtureInsights(snapshot = analyticSnapshot) {
  const data = new Map<string, Snapshot>();
  return new InsightsService(new IngestionService({ collect: async (_owner, _repo, range) => ({ ...snapshot, period: range }) }, {
    get: async key => data.get(key) ?? null,
    set: async (key, value) => { data.set(key, value); }, close: async () => {},
  }, 300));
}
export function draft(): NarrativeDraft {
  return {
    observations: [
      { text: 'Four PRs merged, up from one in the preceding period.', evidence: [
        { factId: 'current.mergedPrCount', value: 4 }, { factId: 'previous.mergedPrCount', value: 1 },
      ] },
      { text: 'Median merge time increased from 24 to 60 calendar hours.', evidence: [
        { factId: 'current.medianMergeHours', value: 60 }, { factId: 'previous.medianMergeHours', value: 24 },
      ] },
    ],
    hypothesis: {
      text: 'Larger changes may be contributing to slower delivery, but this is only a hypothesis.', confidence: 0.9,
      rationale: 'Change-size and merge-time medians rose together; the tiny baseline and missing identities limit interpretation.',
      evidence: [
        { factId: 'current.medianChangedLines', value: 25 }, { factId: 'previous.medianChangedLines', value: 10 },
        { factId: 'current.medianMergeHours', value: 60 }, { factId: 'previous.medianMergeHours', value: 24 },
      ],
    },
    limitations: ['Small cohorts and unknown authors limit confidence; correlation does not establish causation.'],
  };
}
export function providerResponse(value: unknown) {
  return {
    id: 'resp_fixture', status: 'completed',
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(value), annotations: [] }] }],
  };
}
