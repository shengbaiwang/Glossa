import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const fixturesDirectory = resolve(scriptDirectory, '../src/__tests__/fixtures/data');
const readingFixtureTime = new Date('2026-08-13T00:00:00Z');
const evaluationFixtureTime = new Date('2026-08-15T00:00:00Z');

const readingFixtureFiles = {
  mimetype: 'application/epub+zip',
  'META-INF/container.xml': `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>
`,
  'OEBPS/package.opf': `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" prefix="dcterms: http://purl.org/dc/terms/">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:9c4b3b36-170c-4bd4-9f14-45d31e600501</dc:identifier>
    <dc:title>Glossa Reading Fixture: Aster Notes / 星标笔记</dc:title>
    <dc:creator>Glossa Project Contributors</dc:creator>
    <dc:language>en</dc:language>
    <dc:language>zh</dc:language>
    <dc:rights>CC0 1.0 Universal — public domain dedication</dc:rights>
    <meta property="dcterms:modified">2026-08-13T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
    <item id="chapter-1" href="chapter-1.xhtml" media-type="application/xhtml+xml" />
    <item id="chapter-2" href="chapter-2.xhtml" media-type="application/xhtml+xml" />
    <item id="chapter-3" href="chapter-3.xhtml" media-type="application/xhtml+xml" />
  </manifest>
  <spine>
    <itemref idref="chapter-1" />
    <itemref idref="chapter-2" />
    <itemref idref="chapter-3" />
  </spine>
</package>
`,
  'OEBPS/nav.xhtml': `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en">
  <head><title>Contents</title></head>
  <body>
    <nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops">
      <h1>Contents / 目录</h1>
      <ol>
        <li><a href="chapter-1.xhtml">1. The Aster Index / 星标索引</a></li>
        <li><a href="chapter-2.xhtml">2. The Shared Margin / 共享页边</a></li>
        <li><a href="chapter-3.xhtml">3. Return Signals / 回读信号</a></li>
      </ol>
    </nav>
  </body>
</html>
`,
  'OEBPS/chapter-1.xhtml': `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en">
  <head><title>The Aster Index / 星标索引</title></head>
  <body>
    <section id="chapter-1" epub:type="chapter" xmlns:epub="http://www.idpf.org/2007/ops">
      <h1>The Aster Index / 星标索引</h1>
      <p id="c1-p1">The Aster Index records every amber mark before the reader turns the page.</p>
      <p id="c1-p2" lang="zh">星标索引在读者翻页前记录每一个琥珀色标记。</p>
      <p id="c1-p3">Its first rule is stable: an amber mark points to a passage, not to an answer.</p>
    </section>
  </body>
</html>
`,
  'OEBPS/chapter-2.xhtml': `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en">
  <head><title>The Shared Margin / 共享页边</title></head>
  <body>
    <section id="chapter-2" epub:type="chapter" xmlns:epub="http://www.idpf.org/2007/ops">
      <h1>The Shared Margin / 共享页边</h1>
      <p id="c2-p1">A shared margin connects a new question to the Aster Index without replacing the original passage.</p>
      <p id="c2-p2" lang="zh">共享页边把新问题连接到前文的星标索引，同时保留原始段落。</p>
      <p id="c2-p3">When an amber mark reappears, the margin asks the reader to compare evidence across chapters.</p>
    </section>
  </body>
</html>
`,
  'OEBPS/chapter-3.xhtml': `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en">
  <head><title>Return Signals / 回读信号</title></head>
  <body>
    <section id="chapter-3" epub:type="chapter" xmlns:epub="http://www.idpf.org/2007/ops">
      <h1>Return Signals / 回读信号</h1>
      <p id="c3-p1">A return signal brings the reader from a shared margin back to the exact amber mark that supplied the evidence.</p>
      <p id="c3-p2" lang="zh">回读信号会把读者从共享页边带回提供证据的确切琥珀色标记。</p>
      <p id="c3-p3">The Aster Index therefore supports recall: the later note remains connected to its earlier chapter.</p>
    </section>
  </body>
</html>
`,
};

export const evaluationFixtures = [
  {
    id: 'glossa-eval-theory-of-frames',
    filename: 'theory-of-frames.epub',
    type: 'theory',
    title: 'Frames for a Small Claim',
    identifier: 'glossa-eval-theory-of-frames',
    purpose: 'Small conceptual argument with an explicit later counterexample.',
    unreadBoundary: { afterChapterId: 'theory-chapter-2', unreadChapterIds: ['theory-chapter-3'] },
    chapters: [
      {
        id: 'theory-chapter-1',
        title: 'A Claim and Its Frame',
        paragraphs: [
          ['theory-c1-p1', 'The study room calls a hinge claim a sentence that joins an observation to a conclusion.'],
          ['theory-c1-p2', 'A hinge claim has two duties: it names the observation and it states what the observation is meant to support.'],
          ['theory-c1-p3', 'In this book, a frame is the stated condition that limits how far a hinge claim may travel.'],
        ],
      },
      {
        id: 'theory-chapter-2',
        title: 'Comparing Frames',
        paragraphs: [
          ['theory-c2-p1', 'When the same hinge claim appears in two frames, comparison asks which stated condition changed.'],
          ['theory-c2-p2', 'The blue card contains the observation that three readers paused at the same sentence during the first session.'],
          ['theory-c2-p3', 'That observation supports attention only within the quiet-room frame, because the first session excluded conversation.'],
        ],
      },
      {
        id: 'theory-chapter-3',
        title: 'The Later Counterexample',
        paragraphs: [
          ['theory-c3-p1', 'After the second seminar, the blue card is reconsidered in a room where conversation is allowed.'],
          ['theory-c3-p2', 'The counterexample shows that the first observation cannot by itself support a claim about attention in every room.'],
          ['theory-c3-p3', 'The earlier frame is not erased; it remains the boundary that makes the counterexample intelligible.'],
        ],
      },
    ],
  },
  {
    id: 'glossa-eval-signal-ledger',
    filename: 'signal-ledger.epub',
    type: 'technical',
    title: 'The Signal Ledger Protocol',
    identifier: 'glossa-eval-signal-ledger',
    purpose: 'Compact protocol specification with exact fields, a validation rule, and a later recovery path.',
    unreadBoundary: { afterChapterId: 'technical-chapter-2', unreadChapterIds: ['technical-chapter-3'] },
    chapters: [
      {
        id: 'technical-chapter-1',
        title: 'Ledger Lines',
        paragraphs: [
          ['technical-c1-p1', 'A Signal Ledger line has exactly three fields: tag, value, and witness.'],
          ['technical-c1-p2', 'The tag is lowercase ASCII, the value is an unsigned decimal integer, and the witness is a six-letter word.'],
          ['technical-c1-p3', 'Writers append one line at a time; they do not rewrite an accepted line.'],
        ],
      },
      {
        id: 'technical-chapter-2',
        title: 'Validation Run',
        paragraphs: [
          ['technical-c2-p1', 'A validator accepts a line only when its witness matches the checksum word produced from its tag and value.'],
          ['technical-c2-p2', 'For the demonstration input beacon, 17, the checksum word is cedar.'],
          ['technical-c2-p3', 'A rejected line is recorded in the error log and is not counted in the running total.'],
        ],
      },
      {
        id: 'technical-chapter-3',
        title: 'Recovery Procedure',
        paragraphs: [
          ['technical-c3-p1', 'If a witness was copied incorrectly, recovery begins by preserving the rejected line and creating a new candidate line.'],
          ['technical-c3-p2', 'The new candidate uses the original tag and value but a freshly computed witness; the old line remains visible for audit.'],
          ['technical-c3-p3', 'Recovery never changes the running total until the new candidate is accepted.'],
        ],
      },
    ],
  },
  {
    id: 'glossa-eval-tern-quay',
    filename: 'tern-quay.epub',
    type: 'narrative',
    title: 'The Lantern at Tern Quay',
    identifier: 'glossa-eval-tern-quay',
    purpose: 'Short narrative with recurring objects, causal details, and a later reveal outside the read boundary.',
    unreadBoundary: { afterChapterId: 'narrative-chapter-2', unreadChapterIds: ['narrative-chapter-3'] },
    chapters: [
      {
        id: 'narrative-chapter-1',
        title: 'Low Tide',
        paragraphs: [
          ['narrative-c1-p1', 'Mara arrived at Tern Quay before dawn carrying a brass wind key wrapped in green cloth.'],
          ['narrative-c1-p2', 'The harbor lantern was dark, and the tide had left a line of silver shells below its steps.'],
          ['narrative-c1-p3', 'Mara placed the key in her coat pocket when she heard Jori calling from the pier.'],
        ],
      },
      {
        id: 'narrative-chapter-2',
        title: 'The Folded Chart',
        paragraphs: [
          ['narrative-c2-p1', 'Jori carried a folded blue chart marked with a circle beside the old lantern.'],
          ['narrative-c2-p2', 'He said the circle was drawn by his grandmother, who had tended the light during storms.'],
          ['narrative-c2-p3', 'Mara compared the circle with the brass wind key but did not yet turn either one.'],
        ],
      },
      {
        id: 'narrative-chapter-3',
        title: 'When the Light Returns',
        paragraphs: [
          ['narrative-c3-p1', 'At sunset, Mara discovered that the brass wind key opened the lantern cabinet, not the harbor gate.'],
          ['narrative-c3-p2', 'Inside the cabinet, the blue chart named the circle a safe anchorage for boats during a sudden east wind.'],
          ['narrative-c3-p3', 'Jori lit the lantern, and its first beam crossed the silver shells from the morning tide.'],
        ],
      },
    ],
  },
];

function escapeXml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function createEvaluationEpubFiles(fixture) {
  const manifestItems = fixture.chapters
    .map(
      (chapter, index) =>
        `    <item id="${chapter.id}" href="chapter-${index + 1}.xhtml" media-type="application/xhtml+xml" />`,
    )
    .join('\n');
  const spineItems = fixture.chapters.map((chapter) => `    <itemref idref="${chapter.id}" />`).join('\n');
  const tocItems = fixture.chapters
    .map(
      (chapter, index) => `        <li><a href="chapter-${index + 1}.xhtml">${index + 1}. ${escapeXml(chapter.title)}</a></li>`)
    .join('\n');
  const files = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>
`,
    'OEBPS/package.opf': `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" prefix="dcterms: http://purl.org/dc/terms/">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${fixture.identifier}</dc:identifier>
    <dc:title>${escapeXml(fixture.title)}</dc:title>
    <dc:creator>Glossa Project Contributors</dc:creator>
    <dc:language>en</dc:language>
    <dc:rights>CC0 1.0 Universal — public domain dedication</dc:rights>
    <meta property="dcterms:modified">2026-08-15T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
${manifestItems}
  </manifest>
  <spine>
${spineItems}
  </spine>
</package>
`,
    'OEBPS/nav.xhtml': `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en">
  <head><title>Contents</title></head>
  <body>
    <nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops">
      <h1>Contents</h1>
      <ol>
${tocItems}
      </ol>
    </nav>
  </body>
</html>
`,
  };

  fixture.chapters.forEach((chapter, index) => {
    const paragraphs = chapter.paragraphs
      .map(([id, text]) => `      <p id="${id}">${escapeXml(text)}</p>`)
      .join('\n');
    files[`OEBPS/chapter-${index + 1}.xhtml`] = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en">
  <head><title>${escapeXml(chapter.title)}</title></head>
  <body>
    <section id="${chapter.id}" epub:type="chapter" xmlns:epub="http://www.idpf.org/2007/ops">
      <h1>${escapeXml(chapter.title)}</h1>
${paragraphs}
    </section>
  </body>
</html>
`;
  });

  return files;
}

async function createEpub(
  outputPath,
  files,
  fixtureTime,
  archiveEntries = ['META-INF', 'OEBPS'],
  recursive = false,
) {
  const stagingDirectory = await mkdtemp(resolve(tmpdir(), 'glossa-epub-'));

  try {
    for (const [relativePath, contents] of Object.entries(files)) {
      const outputPath = resolve(stagingDirectory, relativePath);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, contents, 'utf8');
      await utimes(outputPath, fixtureTime, fixtureTime);
    }
    await utimes(resolve(stagingDirectory, 'META-INF'), fixtureTime, fixtureTime);
    await utimes(resolve(stagingDirectory, 'OEBPS'), fixtureTime, fixtureTime);

    await rm(outputPath, { force: true });
    await execFileAsync('/usr/bin/zip', ['-X', '-q', '-0', outputPath, 'mimetype'], { cwd: stagingDirectory });
    await execFileAsync('/usr/bin/zip', ['-X', '-q', '-9', ...(recursive ? ['-r'] : []), outputPath, ...archiveEntries], {
      cwd: stagingDirectory,
    });
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
  }
}

async function sha256(path) {
  const { readFile } = await import('node:fs/promises');
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

function createEvaluationManifest(checksums) {
  return {
    version: 1,
    generatedAt: '2026-08-15T00:00:00Z',
    license: 'CC0-1.0',
    scope: 'I01 corpus only; it contains no question set, model results, human scores, or API data.',
    documents: evaluationFixtures.map((fixture) => ({
      documentId: fixture.id,
      type: fixture.type,
      title: fixture.title,
      path: `glossa-evaluation/${fixture.filename}`,
      license: 'CC0-1.0',
      purpose: fixture.purpose,
      unreadBoundary: fixture.unreadBoundary,
      chapters: fixture.chapters.map((chapter, index) => ({
        id: chapter.id,
        href: `OEBPS/chapter-${index + 1}.xhtml`,
        title: chapter.title,
        paragraphIds: chapter.paragraphs.map(([id]) => id),
      })),
      checksum: { algorithm: 'sha256', value: checksums[fixture.id] },
    })),
  };
}

function serializeEvaluationManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)
    .replace(/"unreadChapterIds": \[\n\s+"([^"]+)"\n\s+\]/g, '"unreadChapterIds": ["$1"]')
    .replace(
      /"paragraphIds": \[\n\s+"([^"]+)",\n\s+"([^"]+)",\n\s+"([^"]+)"\n\s+\]/g,
      '"paragraphIds": ["$1", "$2", "$3"]',
    )}\n`;
}

export async function generateGlossaEpubFixtures() {
  const readingFixturePath = resolve(fixturesDirectory, 'glossa-reading-sample.epub');
  await createEpub(readingFixturePath, readingFixtureFiles, readingFixtureTime, ['META-INF', 'OEBPS'], true);

  const evaluationDirectory = resolve(fixturesDirectory, 'glossa-evaluation');
  await mkdir(evaluationDirectory, { recursive: true });
  const checksums = {};
  for (const fixture of evaluationFixtures) {
    const outputPath = resolve(evaluationDirectory, fixture.filename);
    const files = createEvaluationEpubFiles(fixture);
    await createEpub(
      outputPath,
      files,
      evaluationFixtureTime,
      Object.keys(files).filter((path) => path !== 'mimetype'),
    );
    checksums[fixture.id] = await sha256(outputPath);
  }

  const manifestPath = resolve(fixturesDirectory, 'glossa-evaluation-manifest.json');
  await writeFile(manifestPath, serializeEvaluationManifest(createEvaluationManifest(checksums)), 'utf8');
  return { manifestPath, checksums };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { manifestPath } = await generateGlossaEpubFixtures();
  console.log(`Generated Glossa EPUB fixtures and ${manifestPath}`);
}
