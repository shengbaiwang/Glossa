import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { evaluationFixtures, generateGlossaEpubFixtures } from './generate-glossa-epub-fixture.mjs';

const execFileAsync = promisify(execFile);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const fixturesDirectory = resolve(scriptDirectory, '../src/__tests__/fixtures/data');
const manifestPath = resolve(fixturesDirectory, 'glossa-evaluation-manifest.json');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

function verifyMimetypeEntry(bytes, path) {
  assert(bytes.readUInt32LE(0) === 0x04034b50, `${path}: missing first local ZIP header`);
  assert(bytes.readUInt16LE(8) === 0, `${path}: mimetype entry must be uncompressed`);
  const filenameLength = bytes.readUInt16LE(26);
  assert(bytes.subarray(30, 30 + filenameLength).toString('utf8') === 'mimetype', `${path}: mimetype is not first`);
}

async function readArchiveEntry(path, entry) {
  const { stdout } = await execFileAsync('/usr/bin/unzip', ['-p', path, entry], { encoding: 'utf8' });
  return stdout;
}

async function verifyFixture(fixture, manifestDocument) {
  const path = resolve(fixturesDirectory, 'glossa-evaluation', fixture.filename);
  const bytes = await readFile(path);
  verifyMimetypeEntry(bytes, path);
  await execFileAsync('/usr/bin/unzip', ['-tq', path]);

  assert(manifestDocument.documentId === fixture.id, `${fixture.id}: manifest document ID changed`);
  assert(manifestDocument.license === 'CC0-1.0', `${fixture.id}: manifest license must be CC0-1.0`);
  assert(manifestDocument.checksum.algorithm === 'sha256', `${fixture.id}: checksum algorithm must be sha256`);
  assert(manifestDocument.checksum.value === (await sha256(path)), `${fixture.id}: checksum mismatch`);
  assert(
    manifestDocument.unreadBoundary.afterChapterId === fixture.unreadBoundary.afterChapterId,
    `${fixture.id}: unread boundary changed`,
  );

  const packageDocument = await readArchiveEntry(path, 'OEBPS/package.opf');
  assert(packageDocument.includes(`<dc:identifier id="book-id">${fixture.id}</dc:identifier>`), `${fixture.id}: missing document ID`);
  assert(packageDocument.includes('CC0 1.0 Universal'), `${fixture.id}: missing CC0 declaration`);

  for (const [chapterIndex, chapter] of fixture.chapters.entries()) {
    const chapterDocument = await readArchiveEntry(path, `OEBPS/chapter-${chapterIndex + 1}.xhtml`);
    assert(chapterDocument.includes(`id="${chapter.id}"`), `${fixture.id}: missing chapter ID ${chapter.id}`);
    for (const [paragraphId, text] of chapter.paragraphs) {
      assert(chapterDocument.includes(`id="${paragraphId}"`), `${fixture.id}: missing paragraph ID ${paragraphId}`);
      assert(chapterDocument.includes(text), `${fixture.id}: unreadable paragraph ${paragraphId}`);
    }
  }
}

await generateGlossaEpubFixtures();
const firstChecksums = await Promise.all(
  evaluationFixtures.map(async (fixture) => sha256(resolve(fixturesDirectory, 'glossa-evaluation', fixture.filename))),
);
await generateGlossaEpubFixtures();
const secondChecksums = await Promise.all(
  evaluationFixtures.map(async (fixture) => sha256(resolve(fixturesDirectory, 'glossa-evaluation', fixture.filename))),
);
assert(JSON.stringify(firstChecksums) === JSON.stringify(secondChecksums), 'EPUB generation is not byte-for-byte repeatable');

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
assert(manifest.version === 1, 'manifest version must be 1');
assert(manifest.license === 'CC0-1.0', 'manifest license must be CC0-1.0');
assert(manifest.documents.length === 3, 'manifest must contain exactly three EPUBs');
assert(
  JSON.stringify(manifest.documents.map((document) => document.type).sort()) === JSON.stringify(['narrative', 'technical', 'theory']),
  'manifest must contain theory, technical, and narrative EPUBs',
);

for (const fixture of evaluationFixtures) {
  const manifestDocument = manifest.documents.find((document) => document.documentId === fixture.id);
  assert(manifestDocument, `${fixture.id}: missing manifest record`);
  await verifyFixture(fixture, manifestDocument);
}

console.log('Verified 3 deterministic CC0 Glossa EPUB evaluation fixtures.');
