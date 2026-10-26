import { describe, expect, it, vi } from 'vitest';
import { makeMarkdownBook } from '@/utils/md';
import { createReflowableBookAccess } from '@/glossa/harness/reflowable';
import { resolveSource } from '@/glossa/citations/sources';

const original = `前言中的独立证据。

# 方法

研究采用逐段核对。

## 代码

~~~python
def check(value):
    if value > 2:
        return value + 1
~~~

| 条件 | 结论 |
| --- | --- |
| 甲 | 乙 |

补充证据[^1]。

[^1]: 原创脚注中的限制。

# 结果

最终结果只在条件成立时有效。
`;
const make = () => makeMarkdownBook(new File([original], 'original.md'));
const signal = () => new AbortController().signal;

describe('Markdown reading sources', () => {
  it('reads lazily and covers preamble, code, tables, footnotes and final sections', async () => {
    const book = await make();
    const reads = book.sections.map((section) => vi.spyOn(section, 'createDocument'));
    const access = createReflowableBookAccess(book, 'original-content');
    expect(reads.every((read) => read.mock.calls.length === 0)).toBe(true);
    const sources = await access.readAll(signal());
    const text = sources.map((source) => source.text).join('\n');
    for (const evidence of [
      '前言中的独立证据',
      'def check(value)',
      '甲',
      '乙',
      '原创脚注中的限制',
      '最终结果',
    ])
      expect(text).toContain(evidence);
    expect(await access.verifySources(sources, signal())).toHaveLength(sources.length);
    expect(sources.find((source) => source.text.includes('def check'))).toMatchObject({
      kind: 'code',
      text: 'def check(value):\n    if value > 2:\n        return value + 1',
    });
    const copy = await access.readAll(signal());
    copy[0]!.text = 'changed';
    expect((await access.readAll(signal()))[0]!.text).not.toBe('changed');
    book.destroy?.();
  });

  it('restores a source after reopening and refuses a different version', async () => {
    const book = await make();
    const sources = await createReflowableBookAccess(book, 'original-content').readAll(signal());
    const source = sources.find((source) => source.text.includes('最终结果'))!;
    const reopened = await make();
    expect(await resolveSource(reopened, source)).toMatchObject({
      text: source.text,
      recovered: false,
    });
    const changed = await makeMarkdownBook(
      new File(
        [original.replace('最终结果只在条件成立时有效。', '新版本并无相同结论。')],
        'original.md',
      ),
    );
    expect(await resolveSource(changed, source)).toBeNull();
    for (const doc of [book, reopened, changed]) doc.destroy?.();
  });

  it('rejects code whose indentation has changed', async () => {
    const book = await make();
    const sources = await createReflowableBookAccess(book, 'original-content').readAll(signal());
    const source = sources.find((source) => source.kind === 'code')!;
    const changed = await makeMarkdownBook(
      new File([original.replace('        return', '    return')], 'original.md'),
    );
    expect(await resolveSource(changed, source)).toBeNull();
    book.destroy?.();
    changed.destroy?.();
  });

  it('cancels preparation and searches actual local text', async () => {
    const book = await make();
    const access = createReflowableBookAccess(book, 'original-content');
    const controller = new AbortController();
    controller.abort();
    await expect(access.readAll(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    const found = await access.search(['最终结果'], signal());
    expect(found.some((source) => source.text.includes('最终结果'))).toBe(true);
    expect(await access.verifySources(found, signal())).toHaveLength(found.length);
    book.destroy?.();
  });
});

it('renders common math while keeping source expressions, currency and code intact', async () => {
  const content = String.raw`# Formula

行内 $E=mc^2$ 与价格 $5 and $10。

$$
\frac{a}{b} + \sqrt{x}
$$

~~~sh
printf '$HOME costs $5'
~~~

$\href{javascript:alert(1)}{bad}$
`;
  const book = await makeMarkdownBook(new File([content], 'formula.md'));
  const doc = await book.sections[0]!.createDocument();
  expect(doc.querySelectorAll('math')).toHaveLength(3);
  expect(doc.querySelector('math[display="block"]')).toBeTruthy();
  expect(doc.body.textContent).toContain('$5 and $10');
  expect(doc.querySelector('pre')?.textContent).toContain('$HOME costs $5');
  expect(doc.querySelector('a[href^="javascript:"]')).toBeNull();
  const access = createReflowableBookAccess(book, 'formula-content');
  const sources = await access.readAll(signal());
  const text = sources.map((source) => source.text).join('\n');
  expect(text).toContain('E=mc^2');
  expect(text).toContain(String.raw`\frac{a}{b} + \sqrt{x}`);
  expect(text.match(/E=mc\^2/g)).toHaveLength(1);
  expect(await access.verifySources(sources, signal())).toHaveLength(sources.length);
  book.destroy?.();
});
