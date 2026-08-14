import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const fixturesDirectory = resolve(scriptDirectory, '../src/__tests__/fixtures/data');
const manifestPath = resolve(fixturesDirectory, 'glossa-evaluation-manifest.json');
const questionSetPath = resolve(fixturesDirectory, 'glossa-evaluation-question-set.json');
const schemaPath = resolve(fixturesDirectory, 'glossa-evaluation-question-set.schema.json');

const corpusTypes = ['theory', 'technical', 'narrative'];
const questionKinds = [
  'current-paragraph',
  'cross-chapter',
  'no-answer',
  'conflicting-evidence',
  'unread-future',
];

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
  assert(typeof value === 'string' && value.length > 0, `${context}: expected a non-empty string`);
}

function assertParagraphIds(value, context) {
  assert(Array.isArray(value), `${context}: expected an array`);
  const ids = new Set();
  for (const id of value) {
    assertString(id, `${context} item`);
    assert(!ids.has(id), `${context}: duplicate paragraph ID ${id}`);
    ids.add(id);
  }
}

function sameIds(left, right) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildDocumentIndex(manifest) {
  assert(manifest.version === 1, 'manifest: expected version 1');
  assert(Array.isArray(manifest.documents), 'manifest: documents must be an array');

  const documents = new Map();
  for (const document of manifest.documents) {
    assertObject(document, 'manifest document');
    assertString(document.documentId, 'manifest document ID');
    assert(!documents.has(document.documentId), `manifest: duplicate document ID ${document.documentId}`);
    assert(corpusTypes.includes(document.type), `${document.documentId}: unsupported corpus type ${document.type}`);
    assertObject(document.unreadBoundary, `${document.documentId}: unread boundary`);
    assertString(document.unreadBoundary.afterChapterId, `${document.documentId}: unread boundary chapter`);
    assert(Array.isArray(document.chapters), `${document.documentId}: chapters must be an array`);

    const chapters = new Map();
    const paragraphs = new Map();
    const orderedParagraphIds = [];
    for (const chapter of document.chapters) {
      assertObject(chapter, `${document.documentId}: chapter`);
      assertString(chapter.id, `${document.documentId}: chapter ID`);
      assert(!chapters.has(chapter.id), `${document.documentId}: duplicate chapter ID ${chapter.id}`);
      assert(Array.isArray(chapter.paragraphIds), `${document.documentId}/${chapter.id}: paragraph IDs must be an array`);
      chapters.set(chapter.id, chapter);
      for (const paragraphId of chapter.paragraphIds) {
        assertString(paragraphId, `${document.documentId}/${chapter.id}: paragraph ID`);
        assert(!paragraphs.has(paragraphId), `${document.documentId}: duplicate paragraph ID ${paragraphId}`);
        paragraphs.set(paragraphId, { chapterId: chapter.id, position: orderedParagraphIds.length });
        orderedParagraphIds.push(paragraphId);
      }
    }

    assert(chapters.has(document.unreadBoundary.afterChapterId), `${document.documentId}: unread boundary chapter is unknown`);
    const boundaryChapter = chapters.get(document.unreadBoundary.afterChapterId);
    assert(boundaryChapter.paragraphIds.length > 0, `${document.documentId}: unread boundary chapter has no paragraphs`);
    assert(Array.isArray(document.unreadBoundary.unreadChapterIds), `${document.documentId}: unread chapters must be an array`);
    for (const unreadChapterId of document.unreadBoundary.unreadChapterIds) {
      assert(chapters.has(unreadChapterId), `${document.documentId}: unread chapter is unknown ${unreadChapterId}`);
    }

    documents.set(document.documentId, {
      document,
      chapters,
      paragraphs,
      orderedParagraphIds,
      boundaryParagraphId: boundaryChapter.paragraphIds.at(-1),
    });
  }
  return documents;
}

function validateQuestionSet(questionSet, manifest) {
  assertKeys(questionSet, ['schemaVersion', 'questionSetId', 'corpus', 'questions'], 'question set');
  assertRequiredKeys(questionSet, ['schemaVersion', 'questionSetId', 'corpus', 'questions'], 'question set');
  assert(questionSet.schemaVersion === 1, 'question set: schemaVersion must be 1');
  assert(questionSet.questionSetId === 'glossa-epub-evaluation-questions', 'question set: unexpected questionSetId');
  assertKeys(questionSet.corpus, ['manifestPath', 'manifestVersion'], 'question set corpus');
  assertRequiredKeys(questionSet.corpus, ['manifestPath', 'manifestVersion'], 'question set corpus');
  assert(questionSet.corpus.manifestPath === 'glossa-evaluation-manifest.json', 'question set: unexpected manifest path');
  assert(questionSet.corpus.manifestVersion === manifest.version, 'question set: manifest version does not match corpus');
  assert(Array.isArray(questionSet.questions) && questionSet.questions.length >= 15, 'question set: requires at least 15 questions');

  const documents = buildDocumentIndex(manifest);
  const seenQuestionIds = new Set();
  const coverage = new Map(corpusTypes.map((type) => [type, new Set()]));

  for (const question of questionSet.questions) {
    assertKeys(
      question,
      ['id', 'documentId', 'corpusType', 'kind', 'question', 'readingBoundary', 'currentParagraphId', 'expected'],
      'question',
    );
    assertRequiredKeys(
      question,
      ['id', 'documentId', 'corpusType', 'kind', 'question', 'readingBoundary', 'currentParagraphId', 'expected'],
      'question',
    );
    assertString(question.id, 'question ID');
    assert(!seenQuestionIds.has(question.id), `question set: duplicate question ID ${question.id}`);
    assert(
      /^i02-(theory|technical|narrative)-(current-paragraph|cross-chapter|no-answer|conflicting-evidence|unread-future)$/.test(
        question.id,
      ),
      `question ${question.id}: invalid stable ID`,
    );
    seenQuestionIds.add(question.id);
    assertString(question.documentId, `${question.id}: document ID`);
    assert(documents.has(question.documentId), `${question.id}: unknown document ID ${question.documentId}`);
    const indexedDocument = documents.get(question.documentId);
    assert(question.corpusType === indexedDocument.document.type, `${question.id}: corpus type does not match document`);
    assert(corpusTypes.includes(question.corpusType), `${question.id}: unsupported corpus type`);
    assert(questionKinds.includes(question.kind), `${question.id}: unsupported question kind`);
    assert(question.id === `i02-${question.corpusType}-${question.kind}`, `${question.id}: ID must match corpus type and kind`);
    assertString(question.question, `${question.id}: question text`);

    assertKeys(question.readingBoundary, ['throughChapterId', 'throughParagraphId'], `${question.id}: reading boundary`);
    assertRequiredKeys(question.readingBoundary, ['throughChapterId', 'throughParagraphId'], `${question.id}: reading boundary`);
    const { throughChapterId, throughParagraphId } = question.readingBoundary;
    assert(indexedDocument.chapters.has(throughChapterId), `${question.id}: unknown boundary chapter ${throughChapterId}`);
    assert(indexedDocument.paragraphs.has(throughParagraphId), `${question.id}: unknown boundary paragraph ${throughParagraphId}`);
    assert(
      indexedDocument.paragraphs.get(throughParagraphId).chapterId === throughChapterId,
      `${question.id}: boundary paragraph is not in its boundary chapter`,
    );
    assert(
      throughChapterId === indexedDocument.document.unreadBoundary.afterChapterId &&
        throughParagraphId === indexedDocument.boundaryParagraphId,
      `${question.id}: reading boundary must match the corpus unread boundary`,
    );
    assert(indexedDocument.paragraphs.has(question.currentParagraphId), `${question.id}: unknown current paragraph ${question.currentParagraphId}`);
    const boundaryPosition = indexedDocument.paragraphs.get(throughParagraphId).position;
    assert(
      indexedDocument.paragraphs.get(question.currentParagraphId).position <= boundaryPosition,
      `${question.id}: current paragraph exceeds reading boundary`,
    );

    assertKeys(
      question.expected,
      ['status', 'requiredEvidenceParagraphIds', 'prohibitedUnreadParagraphIds', 'conflictingEvidence'],
      `${question.id}: expected`,
    );
    assertRequiredKeys(
      question.expected,
      ['status', 'requiredEvidenceParagraphIds', 'prohibitedUnreadParagraphIds'],
      `${question.id}: expected`,
    );
    const { status, requiredEvidenceParagraphIds, prohibitedUnreadParagraphIds, conflictingEvidence } = question.expected;
    assert(['answered', 'insufficient_evidence'].includes(status), `${question.id}: unsupported expected status`);
    assertParagraphIds(requiredEvidenceParagraphIds, `${question.id}: required evidence`);
    assertParagraphIds(prohibitedUnreadParagraphIds, `${question.id}: prohibited unread evidence`);

    for (const paragraphId of requiredEvidenceParagraphIds) {
      assert(indexedDocument.paragraphs.has(paragraphId), `${question.id}: unknown evidence paragraph ${paragraphId}`);
      assert(
        indexedDocument.paragraphs.get(paragraphId).position <= boundaryPosition,
        `${question.id}: evidence paragraph exceeds reading boundary ${paragraphId}`,
      );
    }
    const expectedUnreadParagraphIds = indexedDocument.orderedParagraphIds.filter(
      (paragraphId) => indexedDocument.paragraphs.get(paragraphId).position > boundaryPosition,
    );
    assert(
      sameIds(prohibitedUnreadParagraphIds, expectedUnreadParagraphIds),
      `${question.id}: prohibited unread paragraphs must list every paragraph after the reading boundary`,
    );

    if (question.kind === 'current-paragraph') {
      assert(status === 'answered', `${question.id}: current-paragraph requires answered status`);
      assert(
        requiredEvidenceParagraphIds.includes(question.currentParagraphId),
        `${question.id}: current-paragraph must require its current paragraph`,
      );
    }
    if (question.kind === 'cross-chapter') {
      assert(status === 'answered', `${question.id}: cross-chapter requires answered status`);
      const evidenceChapters = new Set(requiredEvidenceParagraphIds.map((id) => indexedDocument.paragraphs.get(id).chapterId));
      assert(evidenceChapters.size >= 2, `${question.id}: cross-chapter requires evidence from two chapters`);
    }
    if (question.kind === 'no-answer' || question.kind === 'unread-future') {
      assert(status === 'insufficient_evidence', `${question.id}: ${question.kind} requires insufficient_evidence`);
      assert(requiredEvidenceParagraphIds.length === 0, `${question.id}: ${question.kind} cannot require answer evidence`);
    }
    if (question.kind === 'conflicting-evidence') {
      assert(status === 'answered', `${question.id}: conflicting-evidence requires answered status`);
      assertObject(conflictingEvidence, `${question.id}: conflicting evidence`);
      assertKeys(
        conflictingEvidence,
        ['supportingEvidenceParagraphIds', 'counterEvidenceParagraphIds'],
        `${question.id}: conflicting evidence`,
      );
      assertRequiredKeys(
        conflictingEvidence,
        ['supportingEvidenceParagraphIds', 'counterEvidenceParagraphIds'],
        `${question.id}: conflicting evidence`,
      );
      assertParagraphIds(conflictingEvidence.supportingEvidenceParagraphIds, `${question.id}: supporting evidence`);
      assertParagraphIds(conflictingEvidence.counterEvidenceParagraphIds, `${question.id}: counter evidence`);
      assert(conflictingEvidence.supportingEvidenceParagraphIds.length > 0, `${question.id}: missing supporting evidence`);
      assert(conflictingEvidence.counterEvidenceParagraphIds.length > 0, `${question.id}: missing counter evidence`);
      const bothSides = [
        ...conflictingEvidence.supportingEvidenceParagraphIds,
        ...conflictingEvidence.counterEvidenceParagraphIds,
      ];
      assert(new Set(bothSides).size === bothSides.length, `${question.id}: conflict evidence sides must not overlap`);
      for (const paragraphId of bothSides) {
        assert(indexedDocument.paragraphs.has(paragraphId), `${question.id}: unknown conflict evidence paragraph ${paragraphId}`);
        assert(
          indexedDocument.paragraphs.get(paragraphId).position <= boundaryPosition,
          `${question.id}: conflict evidence exceeds reading boundary ${paragraphId}`,
        );
      }
      assert(
        sameIds([...requiredEvidenceParagraphIds].sort(), [...bothSides].sort()),
        `${question.id}: required evidence must be exactly the two conflict evidence sides`,
      );
    } else {
      assert(conflictingEvidence === undefined, `${question.id}: only conflicting-evidence may include conflictingEvidence`);
    }

    coverage.get(question.corpusType).add(question.kind);
  }

  for (const corpusType of corpusTypes) {
    const coveredKinds = coverage.get(corpusType);
    for (const questionKind of questionKinds) {
      assert(coveredKinds.has(questionKind), `question set: ${corpusType} is missing ${questionKind}`);
    }
  }
}

function expectInvalid(questionSet, manifest, mutate, expectedMessage) {
  const invalidQuestionSet = clone(questionSet);
  mutate(invalidQuestionSet);
  try {
    validateQuestionSet(invalidQuestionSet, manifest);
  } catch (error) {
    assert(error instanceof Error && error.message.includes(expectedMessage), `invalid fixture failed for the wrong reason: ${error}`);
    return;
  }
  throw new Error(`invalid fixture unexpectedly passed: ${expectedMessage}`);
}

function verifyInvalidCombinations(questionSet, manifest) {
  expectInvalid(
    questionSet,
    manifest,
    (invalid) => {
      invalid.questions[1].id = invalid.questions[0].id;
    },
    'duplicate question ID',
  );
  expectInvalid(
    questionSet,
    manifest,
    (invalid) => {
      invalid.questions[0].expected.requiredEvidenceParagraphIds = ['theory-c3-p1'];
    },
    'evidence paragraph exceeds reading boundary',
  );
  expectInvalid(
    questionSet,
    manifest,
    (invalid) => {
      invalid.questions[2].expected.status = 'answered';
    },
    'no-answer requires insufficient_evidence',
  );
  expectInvalid(
    questionSet,
    manifest,
    (invalid) => {
      delete invalid.questions[3].expected.conflictingEvidence;
    },
    'expected an object',
  );
  expectInvalid(
    questionSet,
    manifest,
    (invalid) => {
      invalid.questions[4].expected.prohibitedUnreadParagraphIds.pop();
    },
    'must list every paragraph after the reading boundary',
  );
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function main() {
  await execFileAsync(process.execPath, [resolve(scriptDirectory, 'verify-glossa-epub-evaluation-fixtures.mjs')]);
  const [schema, manifest, questionSet] = await Promise.all([readJson(schemaPath), readJson(manifestPath), readJson(questionSetPath)]);
  assert(schema.$schema === 'https://json-schema.org/draft/2020-12/schema', 'question schema: unexpected JSON Schema draft');
  assert(schema.$id === 'https://glossa.local/schemas/evaluation-question-set-v1.json', 'question schema: unexpected schema ID');
  assert(schema.properties?.schemaVersion?.const === 1, 'question schema: expected schema version 1');
  validateQuestionSet(questionSet, manifest);
  verifyInvalidCombinations(questionSet, manifest);
  console.log('Verified 15 corpus-bound Glossa EPUB evaluation questions and invalid-combination guards.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}

export { validateQuestionSet };
