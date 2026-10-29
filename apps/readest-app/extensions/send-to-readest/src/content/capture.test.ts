import { afterEach, expect, test, vi } from 'vitest';
import { installChromeMock, uninstallChromeMock } from '../__test-utils__/chromeMock';
afterEach(() => {
  uninstallChromeMock();
  document.head.innerHTML = '';
});
test('captures the rendered document with the current URL and real base URI, not canonical URL', async () => {
  vi.resetModules();
  const mock = installChromeMock();
  document.head.innerHTML =
    '<base href="https://assets.example.org/files/"><link rel="canonical" href="https://publisher.example.org/different/article">';
  document.body.innerHTML = '<article>Rendered article</article>';
  await import('./capture');
  const port = mock.runtime.connect.mock.results[0]!.value;
  expect(port.postMessage).toHaveBeenCalledWith({
    snapshot: expect.objectContaining({
      sourceUrl: location.href,
      baseUrl: 'https://assets.example.org/files/',
      html: expect.stringContaining('Rendered article'),
    }),
  });
});
