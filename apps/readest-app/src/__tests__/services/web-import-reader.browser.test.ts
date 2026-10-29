import { afterEach, expect, it, vi } from 'vitest';
import { DocumentLoader } from '@/libs/document';
import type { FoliateView } from '@/types/view';
import { convertPageToEpub } from '@/services/send/conversion/convertToEpub';

let view: FoliateView | undefined;
afterEach(() => {
  view?.close();
  view?.remove();
  view = undefined;
  vi.unstubAllGlobals();
});

it('opens a captured article offline in the real reader with images, MathML, table and footnote targets', async () => {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 32;
  canvas.getContext('2d')!.fillRect(0, 0, 64, 32);
  const png = await (await fetch(canvas.toDataURL())).blob();
  const remoteRequests = vi.fn();
  const realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const address =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (address.startsWith('https://original.example/')) {
      remoteRequests(address);
      if (address.endsWith('/diagram.png'))
        return new Response(png, { headers: { 'content-type': 'image/png' } });
      return new Response('', { status: 404 });
    }
    return realFetch(input, init);
  });
  const html = `<html lang="zh"><head><title>原创河流观测</title><meta name="citation_author" content="原创作者"></head><body><article>
    <h1>原创河流观测</h1><p id="start">本篇原创记录说明河流观测的方法、测量结果与误差，正文应完整保存在本机阅读文件中。</p>
    <h2>测量结果</h2><figure><img src="/diagram.png" alt="原创观测图"><figcaption>图一：水位随时间变化</figcaption></figure>
    <p>采用公式 <math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi><mo>=</mo><mn>2</mn></math> 计算。<a href="#fn1">注一</a></p>
    <table><caption>测量表</caption><tr><th>观测点</th><th>水位</th></tr><tr><td>甲</td><td>2</td></tr></table>
    <aside id="fn1" role="doc-footnote"><p>脚注保留原始测量条件。</p></aside><p id="end">最后一段说明本篇记录的观察边界。</p>
    <script>window.__untrustedArticleScript = true</script></article></body></html>`;
  const converted = await convertPageToEpub(html, 'https://original.example/article', undefined, {
    captureMethod: 'http',
  });
  expect(converted.warnings ?? []).toHaveLength(0);
  expect(converted.author).toBe('原创作者');
  // Loading the persisted EPUB below has no access to the original site.
  remoteRequests.mockClear();
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const address = String(input);
    if (address.startsWith('https://original.example/')) {
      remoteRequests(address);
      throw new Error('offline');
    }
    return realFetch(input, init);
  });
  const { book } = await new DocumentLoader(converted.file).open();
  await import('foliate-js/view.js');
  await import('foliate-js/paginator.js');
  view = document.createElement('foliate-view') as FoliateView;
  view.style.cssText = 'display:block;width:800px;height:650px';
  document.body.append(view);
  await view.open(book);
  view.renderer.setAttribute('flow', 'scrolled');
  await view.goTo(0);
  await expect.poll(() => view!.renderer.getContents().length).toBeGreaterThan(0);
  const doc = view.renderer.getContents()[0]!.doc;
  expect(doc.querySelector('#end')?.textContent).toContain('观察边界');
  expect(doc.querySelector('math mi')?.textContent).toBe('x');
  expect(doc.querySelector('table caption')?.textContent).toBe('测量表');
  expect(doc.querySelector('a[href="#fn1"]')).not.toBeNull();
  expect(doc.querySelector('#fn1')?.textContent).toContain('原始测量条件');
  expect(doc.querySelector('script')).toBeNull();
  await expect.poll(() => doc.querySelector('img')?.naturalWidth).toBe(64);
  expect(remoteRequests).not.toHaveBeenCalled();
}, 30_000);
