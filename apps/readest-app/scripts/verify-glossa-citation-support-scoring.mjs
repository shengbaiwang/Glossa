import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateQuestionSet } from './verify-glossa-evaluation-question-set.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const fixturesDirectory = resolve(scriptDirectory, '../src/__tests__/fixtures/data');
const schemaPath = resolve(fixturesDirectory, 'glossa-citation-support-scores.schema.json');
const templatePath = resolve(fixturesDirectory, 'glossa-citation-support-scores.template.json');
const manifestPath = resolve(fixturesDirectory, 'glossa-evaluation-manifest.json');
const questionSetPath = resolve(fixturesDirectory, 'glossa-evaluation-question-set.json');
const ratings = ['fully_supported', 'partially_supported', 'unsupported'];
const statuses = ['answered', 'insufficient_evidence'];

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

function assertString(value, context) {
  assert(typeof value === 'string' && value.trim().length > 0, `${context}: expected a non-empty string`);
}

function assertShortReason(value, context) {
  assertString(value, context);
  assert(value.length <= 280, `${context}: must be 280 characters or fewer`);
}

function assertReviewerId(value, context) {
  assertString(value, context);
  assert(/^reviewer-[a-z0-9][a-z0-9-]*$/.test(value), `${context}: must be an anonymous reviewer ID`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function scoreKey(record) {
  return `${record.runId}\u0000${record.questionId}\u0000${record.answerParagraph.id}`;
}

function responseKey(record) {
  return `${record.runId}\u0000${record.questionId}`;
}

function recordRunConfiguration(record, runConfigurations, context) {
  const configuration = `${record.modelId}\u0000${record.promptVersion}`;
  const existing = runConfigurations.get(record.runId);
  assert(
    !existing || existing === configuration,
    `${context}: runId must not mix modelId or promptVersion`,
  );
  runConfigurations.set(record.runId, configuration);
}

function buildCorpusIndex(manifest) {
  const documents = new Map();
  for (const document of manifest.documents) {
    const paragraphs = new Map();
    for (const chapter of document.chapters) {
      for (const paragraphId of chapter.paragraphIds) {
        paragraphs.set(paragraphId, paragraphs.size);
      }
    }
    documents.set(document.documentId, { type: document.type, paragraphs });
  }
  return documents;
}

function assertRunFields(record, context) {
  assertString(record.questionId, `${context}: questionId`);
  assertString(record.runId, `${context}: runId`);
  assertString(record.modelId, `${context}: modelId`);
  assertString(record.promptVersion, `${context}: promptVersion`);
  assertReviewerId(record.reviewerId, `${context}: reviewerId`);
}

function validateStatusAssessment(record, questions, seenResponses, runConfigurations) {
  const context = 'status assessment';
  assertKeys(
    record,
    ['questionId', 'runId', 'modelId', 'promptVersion', 'reviewerId', 'actualStatus', 'statusCorrect', 'reason'],
    context,
  );
  assertRequiredKeys(
    record,
    ['questionId', 'runId', 'modelId', 'promptVersion', 'reviewerId', 'actualStatus', 'statusCorrect'],
    context,
  );
  assertRunFields(record, context);
  recordRunConfiguration(record, runConfigurations, context);
  assert(questions.has(record.questionId), `${context}: unknown question ID ${record.questionId}`);
  assert(statuses.includes(record.actualStatus), `${context}: unsupported actualStatus`);
  assert(typeof record.statusCorrect === 'boolean', `${context}: statusCorrect must be boolean`);
  const expectedCorrect = questions.get(record.questionId).expected.status === record.actualStatus;
  assert(record.statusCorrect === expectedCorrect, `${context}: statusCorrect does not match the I02 expected status`);
  if (!record.statusCorrect) {
    assert(Object.hasOwn(record, 'reason'), `${context}: incorrect status requires a reason`);
    assertShortReason(record.reason, `${context}: reason`);
  } else if (Object.hasOwn(record, 'reason')) {
    assertShortReason(record.reason, `${context}: reason`);
  }
  const key = responseKey(record);
  assert(!seenResponses.has(key), `${context}: duplicate scoring for run and question`);
  seenResponses.set(key, record);
}

function validateParagraphScore(record, questions, corpus, responses, seenScores, runConfigurations) {
  const context = 'paragraph score';
  assertKeys(
    record,
    [
      'questionId',
      'runId',
      'modelId',
      'promptVersion',
      'reviewerId',
      'answerParagraph',
      'citedParagraphIds',
      'rating',
      'reason',
    ],
    context,
  );
  assertRequiredKeys(
    record,
    ['questionId', 'runId', 'modelId', 'promptVersion', 'reviewerId', 'answerParagraph', 'citedParagraphIds', 'rating'],
    context,
  );
  assertRunFields(record, context);
  recordRunConfiguration(record, runConfigurations, context);
  assert(questions.has(record.questionId), `${context}: unknown question ID ${record.questionId}`);
  assertObject(record.answerParagraph, `${context}: answerParagraph`);
  assertKeys(record.answerParagraph, ['id', 'text'], `${context}: answerParagraph`);
  assertRequiredKeys(record.answerParagraph, ['id', 'text'], `${context}: answerParagraph`);
  assertString(record.answerParagraph.id, `${context}: answer paragraph ID`);
  assertString(record.answerParagraph.text, `${context}: answer paragraph text`);
  assert(Array.isArray(record.citedParagraphIds), `${context}: citedParagraphIds must be an array`);
  assert(ratings.includes(record.rating), `${context}: unsupported rating`);
  if (record.rating !== 'fully_supported') {
    assert(Object.hasOwn(record, 'reason'), `${context}: ${record.rating} requires a reason`);
    assertShortReason(record.reason, `${context}: reason`);
  } else if (Object.hasOwn(record, 'reason')) {
    assertShortReason(record.reason, `${context}: reason`);
  }
  assert(
    record.citedParagraphIds.length > 0 || record.rating === 'unsupported',
    `${context}: an uncited paragraph must be unsupported`,
  );

  const response = responses.get(responseKey(record));
  assert(response, `${context}: missing status assessment for run and question`);
  assert(response.actualStatus === 'answered', `${context}: insufficient_evidence cannot have paragraph scores`);
  assert(response.modelId === record.modelId, `${context}: modelId differs from its status assessment`);
  assert(response.promptVersion === record.promptVersion, `${context}: promptVersion differs from its status assessment`);

  const question = questions.get(record.questionId);
  const document = corpus.get(question.documentId);
  const boundaryPosition = document.paragraphs.get(question.readingBoundary.throughParagraphId);
  const cited = new Set();
  for (const paragraphId of record.citedParagraphIds) {
    assertString(paragraphId, `${context}: cited paragraph ID`);
    assert(!cited.has(paragraphId), `${context}: duplicate cited paragraph ID ${paragraphId}`);
    cited.add(paragraphId);
    assert(document.paragraphs.has(paragraphId), `${context}: illegal source ${paragraphId}`);
    assert(
      document.paragraphs.get(paragraphId) <= boundaryPosition,
      `${context}: cited evidence crosses the reading boundary ${paragraphId}`,
    );
  }

  const key = scoreKey(record);
  assert(!seenScores.has(key), `${context}: duplicate scoring for answer paragraph`);
  seenScores.add(key);
}

function validateScoreSet(scoreSet, questionSet, manifest) {
  assertKeys(
    scoreSet,
    ['schemaVersion', 'scoreSetId', 'questionSet', 'statusAssessments', 'paragraphScores'],
    'score set',
  );
  assertRequiredKeys(
    scoreSet,
    ['schemaVersion', 'scoreSetId', 'questionSet', 'statusAssessments', 'paragraphScores'],
    'score set',
  );
  assert(scoreSet.schemaVersion === 1, 'score set: schemaVersion must be 1');
  assert(scoreSet.scoreSetId === 'glossa-citation-support-scores', 'score set: unexpected scoreSetId');
  assertKeys(scoreSet.questionSet, ['path', 'schemaVersion', 'questionSetId'], 'score set questionSet');
  assertRequiredKeys(scoreSet.questionSet, ['path', 'schemaVersion', 'questionSetId'], 'score set questionSet');
  assert(scoreSet.questionSet.path === 'glossa-evaluation-question-set.json', 'score set: unexpected question set path');
  assert(scoreSet.questionSet.schemaVersion === questionSet.schemaVersion, 'score set: question set schema version mismatch');
  assert(scoreSet.questionSet.questionSetId === questionSet.questionSetId, 'score set: question set ID mismatch');
  assert(Array.isArray(scoreSet.statusAssessments), 'score set: statusAssessments must be an array');
  assert(Array.isArray(scoreSet.paragraphScores), 'score set: paragraphScores must be an array');

  const questions = new Map(questionSet.questions.map((question) => [question.id, question]));
  const corpus = buildCorpusIndex(manifest);
  const responses = new Map();
  const runConfigurations = new Map();
  for (const assessment of scoreSet.statusAssessments) {
    validateStatusAssessment(assessment, questions, responses, runConfigurations);
  }
  const seenScores = new Set();
  for (const score of scoreSet.paragraphScores) {
    validateParagraphScore(score, questions, corpus, responses, seenScores, runConfigurations);
  }
}

function createCounts() {
  return {
    total: 0,
    fullySupported: 0,
    partiallySupported: 0,
    unsupported: 0,
    citationSupportRate: null,
  };
}

function addScore(counts, rating) {
  counts.total += 1;
  if (rating === 'fully_supported') counts.fullySupported += 1;
  if (rating === 'partially_supported') counts.partiallySupported += 1;
  if (rating === 'unsupported') counts.unsupported += 1;
  counts.citationSupportRate = counts.fullySupported / counts.total;
}

function summarize(scoreSet, questionSet) {
  const questions = new Map(questionSet.questions.map((question) => [question.id, question]));
  const corpusTypes = [...new Set(questionSet.questions.map((question) => question.corpusType))];
  const kinds = [...new Set(questionSet.questions.map((question) => question.kind))];
  const byCorpus = Object.fromEntries(corpusTypes.map((type) => [type, createCounts()]));
  const byQuestionKind = Object.fromEntries(kinds.map((kind) => [kind, createCounts()]));
  const overall = createCounts();

  for (const score of scoreSet.paragraphScores) {
    const question = questions.get(score.questionId);
    addScore(overall, score.rating);
    addScore(byCorpus[question.corpusType], score.rating);
    addScore(byQuestionKind[question.kind], score.rating);
  }

  const insufficientEvidence = scoreSet.statusAssessments.filter(
    (assessment) => assessment.actualStatus === 'insufficient_evidence',
  );
  const correctInsufficientEvidence = insufficientEvidence.filter((assessment) => assessment.statusCorrect).length;
  return {
    schemaVersion: 1,
    total: overall,
    byCorpus,
    byQuestionKind,
    insufficientEvidence: {
      total: insufficientEvidence.length,
      correct: correctInsufficientEvidence,
      incorrect: insufficientEvidence.length - correctInsufficientEvidence,
      statusCorrectRate: insufficientEvidence.length ? correctInsufficientEvidence / insufficientEvidence.length : null,
    },
  };
}

function syntheticValidScoreSet() {
  return {
    schemaVersion: 1,
    scoreSetId: 'glossa-citation-support-scores',
    questionSet: {
      path: 'glossa-evaluation-question-set.json',
      schemaVersion: 1,
      questionSetId: 'glossa-epub-evaluation-questions',
    },
    statusAssessments: [
      {
        questionId: 'i02-theory-current-paragraph',
        runId: 'synthetic-run',
        modelId: 'synthetic-model',
        promptVersion: 'synthetic-prompt-v1',
        reviewerId: 'reviewer-synthetic',
        actualStatus: 'answered',
        statusCorrect: true,
      },
      {
        questionId: 'i02-theory-no-answer',
        runId: 'synthetic-run',
        modelId: 'synthetic-model',
        promptVersion: 'synthetic-prompt-v1',
        reviewerId: 'reviewer-synthetic',
        actualStatus: 'insufficient_evidence',
        statusCorrect: true,
      },
    ],
    paragraphScores: [
      {
        questionId: 'i02-theory-current-paragraph',
        runId: 'synthetic-run',
        modelId: 'synthetic-model',
        promptVersion: 'synthetic-prompt-v1',
        reviewerId: 'reviewer-synthetic',
        answerParagraph: {
          id: 'answer-1',
          text: 'Synthetic paragraph used only to exercise the scoring validator.',
        },
        citedParagraphIds: ['theory-c2-p3'],
        rating: 'fully_supported',
      },
    ],
  };
}

function expectInvalid(scoreSet, questionSet, manifest, mutate, expectedMessage) {
  const invalid = clone(scoreSet);
  mutate(invalid);
  try {
    validateScoreSet(invalid, questionSet, manifest);
  } catch (error) {
    assert(error instanceof Error && error.message.includes(expectedMessage), `invalid sample failed for the wrong reason: ${error}`);
    return;
  }
  throw new Error(`invalid sample unexpectedly passed: ${expectedMessage}`);
}

function verifyExamples(questionSet, manifest) {
  const valid = syntheticValidScoreSet();
  validateScoreSet(valid, questionSet, manifest);
  expectInvalid(
    valid,
    questionSet,
    manifest,
    (invalid) => {
      invalid.paragraphScores[0].questionId = 'i02-missing-question';
    },
    'unknown question ID',
  );
  expectInvalid(
    valid,
    questionSet,
    manifest,
    (invalid) => {
      invalid.paragraphScores[0].citedParagraphIds = ['unknown-paragraph'];
    },
    'illegal source',
  );
  expectInvalid(
    valid,
    questionSet,
    manifest,
    (invalid) => {
      invalid.paragraphScores.push(clone(invalid.paragraphScores[0]));
    },
    'duplicate scoring for answer paragraph',
  );
  expectInvalid(
    valid,
    questionSet,
    manifest,
    (invalid) => {
      invalid.paragraphScores[0].citedParagraphIds = ['theory-c3-p1'];
    },
    'crosses the reading boundary',
  );
  expectInvalid(
    valid,
    questionSet,
    manifest,
    (invalid) => {
      invalid.paragraphScores[0].rating = 'partially_supported';
    },
    'partially_supported requires a reason',
  );
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function main() {
  const scoreFilePath = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : templatePath;
  const [schema, manifest, questionSet, template, scoreSet] = await Promise.all([
    readJson(schemaPath),
    readJson(manifestPath),
    readJson(questionSetPath),
    readJson(templatePath),
    readJson(scoreFilePath),
  ]);
  assert(schema.$schema === 'https://json-schema.org/draft/2020-12/schema', 'score schema: unexpected JSON Schema draft');
  assert(schema.$id === 'https://glossa.local/schemas/citation-support-scores-v1.json', 'score schema: unexpected schema ID');
  assert(schema.properties?.schemaVersion?.const === 1, 'score schema: expected schema version 1');
  validateQuestionSet(questionSet, manifest);
  validateScoreSet(template, questionSet, manifest);
  verifyExamples(questionSet, manifest);
  validateScoreSet(scoreSet, questionSet, manifest);
  console.log(JSON.stringify(summarize(scoreSet, questionSet), null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}

export { summarize, validateScoreSet };
