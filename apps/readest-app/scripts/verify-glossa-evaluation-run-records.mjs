import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateQuestionSet } from './verify-glossa-evaluation-question-set.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const fixturesDirectory = resolve(scriptDirectory, '../src/__tests__/fixtures/data');
const schemaPath = resolve(fixturesDirectory, 'glossa-evaluation-run-records.schema.json');
const templatePath = resolve(fixturesDirectory, 'glossa-evaluation-run-records.template.json');
const manifestPath = resolve(fixturesDirectory, 'glossa-evaluation-manifest.json');
const questionSetPath = resolve(fixturesDirectory, 'glossa-evaluation-question-set.json');

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const rateCards = {
  'deepseek-v4-flash': {
    'deepseek-v4-flash-0731-usd-v1': {
      standard: { cacheHit: 0.0028, cacheMiss: 0.14, output: 0.28 },
    },
    'deepseek-v4-flash-peak-off-peak-usd-2026-08-16-v1': {
      peak: { cacheHit: 0.014, cacheMiss: 0.44, output: 1.32 },
      'off-peak': { cacheHit: 0.007, cacheMiss: 0.22, output: 0.66 },
    },
  },
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertObject(value, context) {
  assert(isObject(value), `${context}: expected an object`);
}

function assertKeys(value, allowedKeys, context) {
  assertObject(value, context);
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    assert(allowed.has(key), `${context}: unexpected property ${key}`);
  }
}

function assertRequiredKeys(value, requiredKeys, context) {
  for (const key of requiredKeys) {
    assert(Object.hasOwn(value, key), `${context}: missing required property ${key}`);
  }
}

function assertIdentifier(value, context) {
  assert(
    typeof value === 'string' && value.length <= 160 && identifierPattern.test(value),
    `${context}: expected a version-style identifier`,
  );
}

function assertNonNegativeInteger(value, context) {
  assert(Number.isInteger(value) && value >= 0, `${context}: expected a non-negative integer`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildCorpusIndex(manifest) {
  assert(manifest.version === 1, 'manifest: expected version 1');
  assert(Array.isArray(manifest.documents), 'manifest: documents must be an array');

  const documents = new Map();
  for (const document of manifest.documents) {
    assertIdentifier(document.documentId, 'manifest document ID');
    assert(!documents.has(document.documentId), `manifest: duplicate document ID ${document.documentId}`);
    const paragraphs = new Map();
    for (const chapter of document.chapters) {
      assertIdentifier(chapter.id, `${document.documentId}: chapter ID`);
      for (const paragraphId of chapter.paragraphIds) {
        assertIdentifier(paragraphId, `${document.documentId}: paragraph ID`);
        assert(!paragraphs.has(paragraphId), `${document.documentId}: duplicate paragraph ID ${paragraphId}`);
        paragraphs.set(paragraphId, { chapterId: chapter.id, position: paragraphs.size });
      }
    }
    documents.set(document.documentId, { type: document.type, paragraphs });
  }
  return documents;
}

function assertQuestionSetBinding(questionSetBinding, questionSet, context) {
  assertKeys(questionSetBinding, ['path', 'schemaVersion', 'questionSetId'], context);
  assertRequiredKeys(questionSetBinding, ['path', 'schemaVersion', 'questionSetId'], context);
  assert(questionSetBinding.path === 'glossa-evaluation-question-set.json', `${context}: unexpected question set path`);
  assert(questionSetBinding.schemaVersion === questionSet.schemaVersion, `${context}: question set schema version mismatch`);
  assert(questionSetBinding.questionSetId === questionSet.questionSetId, `${context}: question set ID mismatch`);
}

function validateRun(run, questionSet, seenRunIds) {
  const context = 'run';
  assertKeys(run, ['runId', 'questionSet', 'codeVersion', 'modelId', 'promptVersion'], context);
  assertRequiredKeys(run, ['runId', 'questionSet', 'codeVersion', 'modelId', 'promptVersion'], context);
  assertIdentifier(run.runId, `${context}: runId`);
  assert(!seenRunIds.has(run.runId), `${context}: duplicate run ID ${run.runId}`);
  seenRunIds.add(run.runId);
  assertQuestionSetBinding(run.questionSet, questionSet, `${context}: questionSet`);
  assertIdentifier(run.codeVersion, `${context}: codeVersion`);
  assertIdentifier(run.modelId, `${context}: modelId`);
  assertIdentifier(run.promptVersion, `${context}: promptVersion`);
}

function expectedD08Cost(modelId, usage, estimate) {
  const modelRates = rateCards[modelId];
  if (!modelRates) return null;
  assert(estimate !== null, 'question record: D08 cost estimate is required for a locally priced model');
  assertObject(estimate, 'question record: d08CostEstimate');
  assertKeys(estimate, ['costUsd', 'rateVersion', 'ratePeriod'], 'question record: d08CostEstimate');
  assertRequiredKeys(estimate, ['costUsd', 'rateVersion', 'ratePeriod'], 'question record: d08CostEstimate');
  assert(typeof estimate.costUsd === 'number' && Number.isFinite(estimate.costUsd) && estimate.costUsd >= 0, 'question record: costUsd must be a non-negative number');
  assertIdentifier(estimate.rateVersion, 'question record: rateVersion');
  assert(['standard', 'peak', 'off-peak'].includes(estimate.ratePeriod), 'question record: unsupported rate period');
  const periodRates = modelRates[estimate.rateVersion]?.[estimate.ratePeriod];
  assert(periodRates, 'question record: D08 rate version or period is inconsistent with the model');
  return (
    (usage.cacheHitTokens * periodRates.cacheHit +
      usage.cacheMissTokens * periodRates.cacheMiss +
      usage.outputTokens * periodRates.output) /
    1_000_000
  );
}

function validateUsage(usage) {
  assertKeys(usage, ['inputTokens', 'outputTokens', 'cacheHitTokens', 'cacheMissTokens'], 'question record: actualUsage');
  assertRequiredKeys(usage, ['inputTokens', 'outputTokens', 'cacheHitTokens', 'cacheMissTokens'], 'question record: actualUsage');
  for (const key of ['inputTokens', 'outputTokens', 'cacheHitTokens', 'cacheMissTokens']) {
    assertNonNegativeInteger(usage[key], `question record: ${key}`);
  }
  assert(
    usage.inputTokens === usage.cacheHitTokens + usage.cacheMissTokens,
    'question record: input token usage must equal cache hits plus cache misses',
  );
}

function validateQuestionRecord(record, runs, questions, corpus, seenRecords) {
  const context = 'question record';
  assertKeys(
    record,
    [
      'runId',
      'questionId',
      'retrievalDurationMs',
      'top10ParagraphIds',
      'firstDisplayableAnswerDurationMs',
      'citationNavigation',
      'actualUsage',
      'd08CostEstimate',
    ],
    context,
  );
  assertRequiredKeys(
    record,
    [
      'runId',
      'questionId',
      'retrievalDurationMs',
      'top10ParagraphIds',
      'firstDisplayableAnswerDurationMs',
      'citationNavigation',
      'actualUsage',
      'd08CostEstimate',
    ],
    context,
  );
  assertIdentifier(record.runId, `${context}: runId`);
  assertIdentifier(record.questionId, `${context}: questionId`);
  const run = runs.get(record.runId);
  assert(run, `${context}: unknown run ID ${record.runId}`);
  const question = questions.get(record.questionId);
  assert(question, `${context}: unknown question ID ${record.questionId}`);
  const key = `${record.runId}\u0000${record.questionId}`;
  assert(!seenRecords.has(key), `${context}: duplicate record for run and question`);
  seenRecords.add(key);

  assertNonNegativeInteger(record.retrievalDurationMs, `${context}: retrievalDurationMs`);
  assertNonNegativeInteger(record.firstDisplayableAnswerDurationMs, `${context}: firstDisplayableAnswerDurationMs`);
  assert(Array.isArray(record.top10ParagraphIds), `${context}: top10ParagraphIds must be an array`);
  assert(record.top10ParagraphIds.length <= 10, `${context}: more than 10 retrieval candidates`);

  const document = corpus.get(question.documentId);
  const boundaryPosition = document.paragraphs.get(question.readingBoundary.throughParagraphId).position;
  const candidates = new Set();
  for (const paragraphId of record.top10ParagraphIds) {
    assertIdentifier(paragraphId, `${context}: retrieval candidate`);
    assert(!candidates.has(paragraphId), `${context}: duplicate retrieval candidate ${paragraphId}`);
    candidates.add(paragraphId);
    const paragraph = document.paragraphs.get(paragraphId);
    assert(paragraph, `${context}: unknown or cross-document paragraph ${paragraphId}`);
    assert(paragraph.position <= boundaryPosition, `${context}: retrieval candidate crosses the reading boundary ${paragraphId}`);
  }

  assertObject(record.citationNavigation, `${context}: citationNavigation`);
  assertKeys(record.citationNavigation, ['attempts', 'successes'], `${context}: citationNavigation`);
  assertRequiredKeys(record.citationNavigation, ['attempts', 'successes'], `${context}: citationNavigation`);
  assertNonNegativeInteger(record.citationNavigation.attempts, `${context}: navigation attempts`);
  assertNonNegativeInteger(record.citationNavigation.successes, `${context}: navigation successes`);
  assert(
    record.citationNavigation.successes <= record.citationNavigation.attempts,
    `${context}: navigation successes exceed attempts`,
  );

  assertObject(record.actualUsage, `${context}: actualUsage`);
  validateUsage(record.actualUsage);
  const expectedCost = expectedD08Cost(run.modelId, record.actualUsage, record.d08CostEstimate);
  if (expectedCost === null) {
    assert(record.d08CostEstimate === null, `${context}: unsupported model must not invent a D08 cost estimate`);
  } else {
    assert(
      Math.abs(record.d08CostEstimate.costUsd - expectedCost) <= 1e-12,
      `${context}: D08 cost estimate is inconsistent with actual usage`,
    );
  }
}

function validateRunRecordSet(recordSet, questionSet, manifest) {
  assertKeys(recordSet, ['schemaVersion', 'recordSetId', 'runs', 'questionRecords'], 'run record set');
  assertRequiredKeys(recordSet, ['schemaVersion', 'recordSetId', 'runs', 'questionRecords'], 'run record set');
  assert(recordSet.schemaVersion === 1, 'run record set: schemaVersion must be 1');
  assert(recordSet.recordSetId === 'glossa-evaluation-run-records', 'run record set: unexpected recordSetId');
  assert(Array.isArray(recordSet.runs), 'run record set: runs must be an array');
  assert(Array.isArray(recordSet.questionRecords), 'run record set: questionRecords must be an array');

  const seenRunIds = new Set();
  for (const run of recordSet.runs) validateRun(run, questionSet, seenRunIds);
  const runs = new Map(recordSet.runs.map((run) => [run.runId, run]));
  const questions = new Map(questionSet.questions.map((question) => [question.id, question]));
  const corpus = buildCorpusIndex(manifest);
  const seenRecords = new Set();
  for (const record of recordSet.questionRecords) {
    validateQuestionRecord(record, runs, questions, corpus, seenRecords);
  }

  for (const runId of runs.keys()) {
    const count = recordSet.questionRecords.filter((record) => record.runId === runId).length;
    assert(
      count === questionSet.questions.length,
      `run ${runId}: requires exactly one record for every I02 question`,
    );
  }
}

function createSummary() {
  return {
    records: 0,
    recalledRequiredEvidence: 0,
    requiredEvidence: 0,
    retrievalDurations: [],
    firstDisplayableAnswerDurations: [],
    navigationAttempts: 0,
    navigationSuccesses: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheHitTokens: 0,
    cacheMissTokens: 0,
    availableD08CostUsd: 0,
    unavailableD08CostRecords: 0,
  };
}

function addRecord(summary, record, question) {
  summary.records += 1;
  summary.retrievalDurations.push(record.retrievalDurationMs);
  summary.firstDisplayableAnswerDurations.push(record.firstDisplayableAnswerDurationMs);
  summary.navigationAttempts += record.citationNavigation.attempts;
  summary.navigationSuccesses += record.citationNavigation.successes;
  summary.inputTokens += record.actualUsage.inputTokens;
  summary.outputTokens += record.actualUsage.outputTokens;
  summary.cacheHitTokens += record.actualUsage.cacheHitTokens;
  summary.cacheMissTokens += record.actualUsage.cacheMissTokens;
  if (record.d08CostEstimate === null) summary.unavailableD08CostRecords += 1;
  else summary.availableD08CostUsd += record.d08CostEstimate.costUsd;

  if (question.kind === 'no-answer' || question.kind === 'unread-future') return;
  const top10 = new Set(record.top10ParagraphIds);
  for (const paragraphId of question.expected.requiredEvidenceParagraphIds) {
    summary.requiredEvidence += 1;
    if (top10.has(paragraphId)) summary.recalledRequiredEvidence += 1;
  }
}

function percentile95(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

function finishSummary(summary) {
  const totalTokens = summary.inputTokens + summary.outputTokens;
  return {
    records: summary.records,
    recallAt10: {
      recalledRequiredEvidence: summary.recalledRequiredEvidence,
      requiredEvidence: summary.requiredEvidence,
      rate: summary.requiredEvidence ? summary.recalledRequiredEvidence / summary.requiredEvidence : null,
    },
    retrievalDurationMsP95: percentile95(summary.retrievalDurations),
    firstDisplayableAnswerDurationMsP95: percentile95(summary.firstDisplayableAnswerDurations),
    citationNavigation: {
      attempts: summary.navigationAttempts,
      successes: summary.navigationSuccesses,
      successRate: summary.navigationAttempts ? summary.navigationSuccesses / summary.navigationAttempts : null,
    },
    actualTokenUsage: {
      inputTokens: summary.inputTokens,
      outputTokens: summary.outputTokens,
      cacheHitTokens: summary.cacheHitTokens,
      cacheMissTokens: summary.cacheMissTokens,
      totalTokens,
    },
    d08CostEstimate: {
      totalEstimatedCostUsd:
        summary.unavailableD08CostRecords === 0 ? summary.availableD08CostUsd : null,
      availableRecordsEstimatedCostUsd: summary.availableD08CostUsd,
      unavailableRecords: summary.unavailableD08CostRecords,
    },
  };
}

function summarize(recordSet, questionSet) {
  const questions = new Map(questionSet.questions.map((question) => [question.id, question]));
  const corpusTypes = [...new Set(questionSet.questions.map((question) => question.corpusType))];
  const kinds = [...new Set(questionSet.questions.map((question) => question.kind))];
  const overall = createSummary();
  const byCorpus = Object.fromEntries(corpusTypes.map((type) => [type, createSummary()]));
  const byQuestionKind = Object.fromEntries(kinds.map((kind) => [kind, createSummary()]));

  for (const record of recordSet.questionRecords) {
    const question = questions.get(record.questionId);
    addRecord(overall, record, question);
    addRecord(byCorpus[question.corpusType], record, question);
    addRecord(byQuestionKind[question.kind], record, question);
  }

  return {
    schemaVersion: 1,
    overall: finishSummary(overall),
    byCorpus: Object.fromEntries(Object.entries(byCorpus).map(([key, value]) => [key, finishSummary(value)])),
    byQuestionKind: Object.fromEntries(
      Object.entries(byQuestionKind).map(([key, value]) => [key, finishSummary(value)]),
    ),
  };
}

function d08EstimateFor(usage) {
  return {
    costUsd: (usage.cacheHitTokens * 0.0028 + usage.cacheMissTokens * 0.14 + usage.outputTokens * 0.28) / 1_000_000,
    rateVersion: 'deepseek-v4-flash-0731-usd-v1',
    ratePeriod: 'standard',
  };
}

function syntheticValidRunRecordSet(questionSet) {
  const usage = {
    inputTokens: 1000,
    outputTokens: 500,
    cacheHitTokens: 250,
    cacheMissTokens: 750,
  };
  return {
    schemaVersion: 1,
    recordSetId: 'glossa-evaluation-run-records',
    runs: [
      {
        runId: 'synthetic-run-v1',
        questionSet: {
          path: 'glossa-evaluation-question-set.json',
          schemaVersion: 1,
          questionSetId: 'glossa-epub-evaluation-questions',
        },
        codeVersion: 'synthetic-code-v1',
        modelId: 'deepseek-v4-flash',
        promptVersion: 'synthetic-prompt-v1',
      },
    ],
    questionRecords: questionSet.questions.map((question, index) => ({
      runId: 'synthetic-run-v1',
      questionId: question.id,
      retrievalDurationMs: 10 + index,
      top10ParagraphIds:
        question.expected.requiredEvidenceParagraphIds.length > 0
          ? question.expected.requiredEvidenceParagraphIds
          : [question.currentParagraphId],
      firstDisplayableAnswerDurationMs: 20 + index,
      citationNavigation: { attempts: 2, successes: 1 },
      actualUsage: usage,
      d08CostEstimate: d08EstimateFor(usage),
    })),
  };
}

function expectInvalid(recordSet, questionSet, manifest, mutate, expectedMessage) {
  const invalid = clone(recordSet);
  mutate(invalid);
  try {
    validateRunRecordSet(invalid, questionSet, manifest);
  } catch (error) {
    assert(error instanceof Error && error.message.includes(expectedMessage), `invalid synthetic sample failed for the wrong reason: ${error}`);
    return;
  }
  throw new Error(`invalid synthetic sample unexpectedly passed: ${expectedMessage}`);
}

function verifySyntheticExamples(questionSet, manifest) {
  const valid = syntheticValidRunRecordSet(questionSet);
  validateRunRecordSet(valid, questionSet, manifest);
  const syntheticSummary = summarize(valid, questionSet);
  const expectedRequiredEvidence = questionSet.questions
    .filter((question) => question.kind !== 'no-answer' && question.kind !== 'unread-future')
    .reduce((total, question) => total + question.expected.requiredEvidenceParagraphIds.length, 0);
  assert(syntheticSummary.overall.records === questionSet.questions.length, 'synthetic summary: missing records');
  assert(
    syntheticSummary.overall.recallAt10.recalledRequiredEvidence === expectedRequiredEvidence &&
      syntheticSummary.overall.recallAt10.requiredEvidence === expectedRequiredEvidence &&
      syntheticSummary.overall.recallAt10.rate === 1,
    'synthetic summary: Recall@10 must exclude no-answer and unread-future questions',
  );
  assert(syntheticSummary.overall.retrievalDurationMsP95 === 24, 'synthetic summary: retrieval P95 is incorrect');
  assert(
    syntheticSummary.overall.firstDisplayableAnswerDurationMsP95 === 34,
    'synthetic summary: first displayable answer P95 is incorrect',
  );
  assert(
    syntheticSummary.overall.citationNavigation.successRate === 0.5,
    'synthetic summary: navigation success rate is incorrect',
  );
  assert(
    syntheticSummary.overall.actualTokenUsage.totalTokens === questionSet.questions.length * 1500,
    'synthetic summary: total token count is incorrect',
  );
  assert(
    Math.abs(
      syntheticSummary.overall.d08CostEstimate.totalEstimatedCostUsd - questionSet.questions.length * 0.0002457,
    ) <= 1e-12,
    'synthetic summary: D08 total cost is incorrect',
  );
  expectInvalid(
    valid,
    questionSet,
    manifest,
    (invalid) => {
      invalid.questionRecords[0].questionId = 'i02-unknown-question';
    },
    'unknown question ID',
  );
  expectInvalid(
    valid,
    questionSet,
    manifest,
    (invalid) => {
      invalid.questionRecords[0].top10ParagraphIds = ['unknown-paragraph'];
    },
    'unknown or cross-document paragraph',
  );
  expectInvalid(
    valid,
    questionSet,
    manifest,
    (invalid) => {
      invalid.questionRecords[0].top10ParagraphIds = ['theory-c3-p1'];
    },
    'crosses the reading boundary',
  );
  expectInvalid(
    valid,
    questionSet,
    manifest,
    (invalid) => {
      invalid.questionRecords[0].top10ParagraphIds = Array.from({ length: 11 }, (_, index) => `synthetic-${index}`);
    },
    'more than 10 retrieval candidates',
  );
  expectInvalid(
    valid,
    questionSet,
    manifest,
    (invalid) => {
      invalid.questionRecords[0].retrievalDurationMs = -1;
    },
    'expected a non-negative integer',
  );
  expectInvalid(
    valid,
    questionSet,
    manifest,
    (invalid) => {
      invalid.questionRecords.push(clone(invalid.questionRecords[0]));
    },
    'duplicate record for run and question',
  );
  expectInvalid(
    valid,
    questionSet,
    manifest,
    (invalid) => {
      invalid.questionRecords[0].actualUsage.inputTokens += 1;
    },
    'input token usage must equal cache hits plus cache misses',
  );
  expectInvalid(
    valid,
    questionSet,
    manifest,
    (invalid) => {
      invalid.questionRecords[0].d08CostEstimate.costUsd += 0.01;
    },
    'D08 cost estimate is inconsistent with actual usage',
  );
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function main() {
  const recordFilePath = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : templatePath;
  const [schema, manifest, questionSet, template, recordSet] = await Promise.all([
    readJson(schemaPath),
    readJson(manifestPath),
    readJson(questionSetPath),
    readJson(templatePath),
    readJson(recordFilePath),
  ]);
  assert(schema.$schema === 'https://json-schema.org/draft/2020-12/schema', 'run record schema: unexpected JSON Schema draft');
  assert(schema.$id === 'https://glossa.local/schemas/evaluation-run-records-v1.json', 'run record schema: unexpected schema ID');
  assert(schema.properties?.schemaVersion?.const === 1, 'run record schema: expected schema version 1');
  validateQuestionSet(questionSet, manifest);
  validateRunRecordSet(template, questionSet, manifest);
  verifySyntheticExamples(questionSet, manifest);
  validateRunRecordSet(recordSet, questionSet, manifest);
  console.log(JSON.stringify(summarize(recordSet, questionSet), null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}

export { summarize, validateRunRecordSet };
