import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(scriptDirectory, '../src/__tests__/fixtures/data/glossa-reading-sample.epub');
const fixtureTime = new Date('2026-08-13T00:00:00Z');

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

  await rm(fixturePath, { force: true });
  await execFileAsync('/usr/bin/zip', ['-X', '-q', '-0', fixturePath, 'mimetype'], {
    cwd: stagingDirectory,
  });
  await execFileAsync('/usr/bin/zip', ['-X', '-q', '-9', '-r', fixturePath, 'META-INF', 'OEBPS'], {
    cwd: stagingDirectory,
  });
  console.log(`Generated ${fixturePath}`);
} finally {
  await rm(stagingDirectory, { recursive: true, force: true });
}
