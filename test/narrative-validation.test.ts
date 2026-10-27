import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFacts, buildPrompt } from '../src/narrative/facts.js';
import { validateNarrative } from '../src/narrative/validation.js';
import { draft, fixtureInsights } from './narrative-fixtures.js';
import { analyticSnapshot } from './insights-fixtures.js';
import { period } from './fixtures.js';

const report = () => fixtureInsights().get('acme', 'project', period);

test('model input contains aggregate facts and uncertainty, excluding account names, PR URLs and raw evidence', async () => {
  const source = await report();
  const facts = buildFacts(source);
  const input = buildPrompt(source, facts);
  assert.equal(facts.length, 47);
  const text = JSON.stringify(input);
  assert.ok(!text.includes('github.com'));
  assert.ok(!text.includes('Alice'));
  assert.ok(!text.includes('acme/project'));
  assert.ok(input.facts.every(fact => !('evidenceIds' in fact)));
  assert.ok(!/pr-\d/.test(text));
  assert.equal(input.facts.find(f => f.id === 'current.medianMergeHours')!.value, 60);
  assert.equal(input.facts.find(f => f.id === 'current.medianMergeHours')!.hasSourceEvidence, true);
  assert.ok(input.warnings.length > 0);
  assert.equal(facts.find(f => f.id === 'changes.reviewedMergedPrPercent.absolute')!.unit, 'percentage_points');
  assert.equal(facts.find(f => f.id === 'changes.closedWithoutMergeRatePercent.relativePercent')!.value, null);
});

test('citations resolve to exact facts and cap model confidence for small samples', async () => {
  const source = await report();
  const result = validateNarrative(draft(), buildFacts(source), source);
  assert.equal(result.draft.hypothesis.confidence, 0.35);
  assert.equal(result.confidencePolicy.modelScore, 0.9);
  assert.equal(result.confidencePolicy.minimumCitedSampleSize, 1);
  assert.equal(result.confidencePolicy.calibrated, false);
  assert.equal(result.citedFacts.length, 6);
  for (const fact of result.citedFacts) {
    assert.ok(fact.evidenceIds.every(id => source.evidence.some(row => row.id === id)));
  }
});

test('fabricated IDs, altered values, duplicated citations, and broken PR evidence fail closed', async () => {
  const source = await report();
  const facts = buildFacts(source);
  const mutations = [
    (value: ReturnType<typeof draft>) => { value.observations[0]!.evidence[0]!.factId = 'invented'; },
    (value: ReturnType<typeof draft>) => { value.observations[0]!.evidence[0]!.value = 999; },
    (value: ReturnType<typeof draft>) => { value.observations[0]!.evidence.push(value.observations[0]!.evidence[0]!); },
    (value: ReturnType<typeof draft>) => { value.hypothesis.confidence = 1.1; },
    (value: ReturnType<typeof draft>) => { value.observations[0]!.text = 'See https://attacker.example'; },
  ];
  for (const mutate of mutations) {
    const value = draft(); mutate(value);
    assert.throws(() => validateNarrative(value, facts, source), { code: 'LLM_INVALID_EVIDENCE' });
  }
  assert.throws(() => validateNarrative(draft(), facts, { ...source, evidence: [] }), { code: 'LLM_INVALID_EVIDENCE' });
});

test('hypotheses require multiple distinct metrics, current evidence, and actual source PRs', async () => {
  const source = await report();
  const facts = buildFacts(source);
  for (const evidence of [
    [{ factId: 'current.medianMergeHours', value: 60 }],
    [{ factId: 'current.medianMergeHours', value: 60 }, { factId: 'previous.medianMergeHours', value: 24 }],
    [{ factId: 'previous.medianMergeHours', value: 24 }, { factId: 'previous.medianChangedLines', value: 10 }],
    [{ factId: 'current.medianMergeHours', value: 60 }, { factId: 'changes.closedWithoutMergeRatePercent.relativePercent', value: null }],
  ]) {
    const value = draft(); value.hypothesis.evidence = evidence;
    assert.throws(() => validateNarrative(value, facts, source), { code: 'LLM_INVALID_EVIDENCE' });
  }
});

test('empty cohorts permit an explicit abstention with zero confidence', async () => {
  const source = await fixtureInsights({ ...analyticSnapshot, pulls: [] }).get('acme', 'project', period);
  const value = {
    observations: [{ text: 'No PRs merged in this period, so timing is unavailable.', evidence: [
      { factId: 'current.mergedPrCount', value: 0 }, { factId: 'current.medianMergeHours', value: null },
    ] }],
    hypothesis: { text: null, confidence: 0, rationale: 'There is no merged cohort to explain.', evidence: [] },
    limitations: ['No merged PR sample is available.'],
  };
  const result = validateNarrative(value, buildFacts(source), source);
  assert.equal(result.draft.hypothesis.text, null);
  assert.equal(result.draft.hypothesis.confidence, 0);
  assert.equal(result.confidencePolicy.appliedCap, 0);
  assert.throws(() => validateNarrative({ ...value, hypothesis: { ...value.hypothesis, confidence: 0.5 } }, buildFacts(source), source),
    { code: 'LLM_INVALID_EVIDENCE' });
});

test('confidence remains capped for larger samples and never raises the model score', async () => {
  const source = await report();
  source.warnings = [];
  for (const cohort of ['current', 'previous'] as const) for (const metric of Object.values(source[cohort].metrics)) metric.sampleSize = 20;
  const facts = buildFacts(source);
  assert.equal(validateNarrative(draft(), facts, source).draft.hypothesis.confidence, 0.75);
  for (const cohort of ['current', 'previous'] as const) for (const metric of Object.values(source[cohort].metrics)) metric.sampleSize = 6;
  assert.equal(validateNarrative(draft(), buildFacts(source), source).draft.hypothesis.confidence, 0.5);
  const low = draft(); low.hypothesis.confidence = 0.2;
  assert.equal(validateNarrative(low, facts, source).draft.hypothesis.confidence, 0.2);
  source.warnings.push({ code: 'PERIOD_NOT_COMPLETE', period: 'current', message: 'Incomplete' });
  assert.equal(validateNarrative(draft(), facts, source).draft.hypothesis.confidence, 0.35);
});
