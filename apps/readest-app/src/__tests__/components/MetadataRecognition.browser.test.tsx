import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import MetadataRecognition from '@/components/metadata/MetadataRecognition';
import type { MetadataRecognition as Recognition } from '@/glossa/metadata/types';
import { useSettingsStore } from '@/store/settingsStore';
import type { SystemSettings } from '@/types/settings';
import type { Book } from '@/types/book';
import '@/styles/globals.css';
import '@/styles/glossa.css';
import '@/styles/glossa-library.css';

const f = vi.hoisted(() => ({
  translations: {} as Record<string, string>,
  load: vi.fn(),
  save: vi.fn(),
  recognize: vi.fn(),
  verify: vi.fn(),
  apply: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => f.translations[key] ?? key,
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: f.navigate }) }));
vi.mock('@/utils/nav', () => ({ navigateToReader: f.navigate }));
vi.mock('@/glossa/metadata/storage', () => ({
  loadMetadataRecognition: f.load,
  saveMetadataRecognition: f.save,
}));
vi.mock('@/glossa/metadata/recognize', () => ({
  recognizeBookMetadata: f.recognize,
  verifyMetadataSource: f.verify,
}));

const book: Book = {
  hash: 'original-metadata-recognition-browser-fixture',
  title: '雨后书简_原始文件名_个人修订版',
  author: '个人保留的作者',
  format: 'EPUB',
  createdAt: 1,
  updatedAt: 1,
  downloadedAt: 1,
  contentFingerprint: 'sha256:original-browser-fixture',
  metadata: { title: '旧文件标题', author: '旧文件作者', language: 'zh' },
};
const result: Recognition = {
  version: 1,
  fingerprint: book.contentFingerprint!,
  complete: false,
  candidates: [
    {
      id: 'title',
      field: 'title',
      value: '雨后书简：关于散步、阅读与日常生活的随笔',
      confidence: 'supported',
      source: {
        kind: 'text',
        label: 'Copyright page',
        excerpt: '雨后书简：关于散步、阅读与日常生活的随笔\n林青 著\n纸页出版社',
        href: 'copyright.xhtml',
      },
    },
    {
      id: 'author',
      field: 'author',
      value: '林青',
      confidence: 'review',
      source: { kind: 'file', label: 'File metadata', excerpt: 'author: 林青' },
    },
    {
      id: 'publisher',
      field: 'publisher',
      value: '纸页出版社',
      confidence: 'supported',
      source: { kind: 'text', label: 'Copyright page', excerpt: '出版：纸页出版社' },
    },
  ],
};
const t = (key: string) => f.translations[key] ?? key;
const candidateLabel = (field: string) => `${t('Candidate')}: ${t(field)}`;
const row = (field: string) =>
  screen.getByRole('button', { name: candidateLabel(field) }).parentElement!;

function openInformation() {
  return render(
    <main className='bg-base-200 text-base-content min-h-screen p-4 sm:p-8'>
      <article className='bg-base-100 mx-auto max-w-2xl p-5 sm:p-8'>
        <h1 className='mb-1 break-words font-serif text-xl'>{book.title}</h1>
        <p className='text-neutral-content mb-6 text-sm'>{book.author}</p>
        <MetadataRecognition book={book} onApply={f.apply} />
      </article>
    </main>,
  );
}

beforeAll(async () => {
  f.translations = await (await fetch('/locales/zh-CN/translation.json')).json();
});
beforeEach(() => {
  for (const mock of [f.load, f.save, f.recognize, f.verify, f.apply, f.navigate]) mock.mockReset();
  f.load.mockResolvedValue(null);
  f.save.mockResolvedValue(undefined);
  f.recognize.mockResolvedValue(result);
  f.verify.mockResolvedValue(result.fingerprint);
  f.apply.mockResolvedValue(true);
  useSettingsStore.setState({ settings: {} as SystemSettings });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  for (const key of ['data-theme', 'dir', 'data-eink'])
    document.documentElement.removeAttribute(key);
});

it.each([
  { name: 'desktop-light', theme: 'default-light', width: 980, eink: false },
  { name: 'desktop-dark', theme: 'default-dark', width: 980, eink: false },
  { name: 'narrow-eink', theme: 'default-light', width: 390, eink: true },
])('keeps inline candidates and evidence readable in $name', async (fixture) => {
  await page.viewport(fixture.width, 1100);
  document.documentElement.setAttribute('data-theme', fixture.theme);
  document.documentElement.setAttribute('data-eink', String(fixture.eink));
  f.load.mockResolvedValue(result);
  openInformation();
  await screen.findByRole('button', { name: candidateLabel('Title') });
  await userEvent.click(within(row('Title')).getByText(t('Show evidence')));
  expect(f.recognize).not.toHaveBeenCalled();
  expect(f.apply).not.toHaveBeenCalled();
  expect(screen.getByRole('heading', { name: book.title })).toBeTruthy();
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(fixture.width);
  for (const control of document.querySelectorAll('button, [role="button"], summary')) {
    const bounds = control.getBoundingClientRect();
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(fixture.width);
  }
  await page.screenshot({
    path: `../../../../../.glossa-dev/qa/metadata-recognition-${fixture.name}.png`,
  });
});

it('starts only on request, edits a candidate in place, and retries a failed adoption', async () => {
  await page.viewport(390, 900);
  document.documentElement.setAttribute('data-theme', 'default-dark');
  openInformation();
  await waitFor(() => expect(f.load).toHaveBeenCalledOnce());
  expect(f.recognize).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: t('Recognize metadata') }));
  await screen.findByRole('button', { name: candidateLabel('Author') });
  expect(f.recognize).toHaveBeenCalledOnce();
  expect(f.apply).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: candidateLabel('Author') }));
  const input = screen.getByRole('textbox', { name: candidateLabel('Author') });
  expect(input.getBoundingClientRect().right).toBeLessThanOrEqual(390);
  await userEvent.fill(input, '林青（修订）');
  await userEvent.keyboard('{Enter}');
  await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
  expect(f.apply).not.toHaveBeenCalled();
  f.apply.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  await userEvent.click(within(row('Author')).getByRole('button', { name: t('Adopt') }));
  await screen.findByRole('alert');
  expect(screen.getByRole('alert').textContent).toBe(t('Failed to save changes'));
  expect(screen.getByRole('button', { name: candidateLabel('Author') }).textContent).toBe(
    '林青（修订）',
  );
  await userEvent.click(within(row('Author')).getByRole('button', { name: t('Adopt') }));
  await waitFor(() => expect(f.apply).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(f.apply).toHaveBeenLastCalledWith(book, { author: '林青（修订）' });
  expect(screen.getByRole('heading', { name: book.title })).toBeTruthy();
});

it('fills only empty supported fields and requires a separate explicit display title adoption', async () => {
  f.load.mockResolvedValue(result);
  openInformation();
  await screen.findByRole('button', { name: t('Fill empty fields') });
  await userEvent.click(screen.getByRole('button', { name: t('Fill empty fields') }));
  await waitFor(() => expect(f.apply).toHaveBeenCalledOnce());
  expect(f.apply).toHaveBeenCalledWith(book, { publisher: '纸页出版社' });
  expect(book.title).toBe('雨后书简_原始文件名_个人修订版');
  expect(book.author).toBe('个人保留的作者');
  await userEvent.click(screen.getByRole('button', { name: t('Use as display title') }));
  await waitFor(() => expect(f.apply).toHaveBeenCalledTimes(2));
  expect(f.apply).toHaveBeenLastCalledWith(book, { title: result.candidates[0]!.value });
});

it('cancels an active recognition when the plugin is disabled and rejects its late result', async () => {
  let signal: AbortSignal | undefined;
  let finish!: (recognition: Recognition) => void;
  f.recognize.mockImplementationOnce((_book: Book, _env: unknown, abort: AbortSignal) => {
    signal = abort;
    return new Promise<Recognition>((resolve) => {
      finish = resolve;
    });
  });
  openInformation();
  await userEvent.click(screen.getByRole('button', { name: t('Recognize metadata') }));
  await waitFor(() => expect(signal).toBeDefined());
  await screen.findByRole('button', { name: t('Cancel') });
  await act(async () => {
    useSettingsStore.setState({
      settings: { officialModules: { metadataRecognition: false } } as SystemSettings,
    });
  });
  expect(signal!.aborted).toBe(true);
  expect(screen.queryByRole('region', { name: t('Metadata recognition') })).toBeNull();
  await act(async () => {
    finish(result);
    useSettingsStore.setState({ settings: {} as SystemSettings });
  });
  await screen.findByRole('button', { name: t('Recognize metadata') });
  expect(screen.queryByRole('button', { name: candidateLabel('Title') })).toBeNull();
  expect(f.recognize).toHaveBeenCalledOnce();
  expect(f.apply).not.toHaveBeenCalled();
});

it.skipIf(!matchMedia('(pointer: coarse)').matches)(
  'provides at least 44px coarse-pointer targets for inline candidates, actions and evidence',
  async () => {
    await page.viewport(390, 900);
    document.documentElement.setAttribute('data-eink', 'true');
    f.load.mockResolvedValue(result);
    openInformation();
    await screen.findByRole('button', { name: candidateLabel('Title') });
    await userEvent.click(within(row('Title')).getByText(t('Show evidence')));
    const section = screen.getByRole('region', { name: t('Metadata recognition') });
    await waitFor(() => {
      for (const control of section.querySelectorAll('button, [role="button"], summary')) {
        const bounds = control.getBoundingClientRect();
        if (bounds.width === 0) continue;
        expect(bounds.height, control.outerHTML).toBeGreaterThanOrEqual(44);
        expect(bounds.width, control.outerHTML).toBeGreaterThanOrEqual(44);
        expect(bounds.left).toBeGreaterThanOrEqual(0);
        expect(bounds.right).toBeLessThanOrEqual(390);
      }
    });
    const author = screen.getByRole('button', { name: candidateLabel('Author') });
    author.focus();
    await userEvent.keyboard('{Enter}');
    const input = screen.getByRole('textbox', { name: candidateLabel('Author') });
    await userEvent.fill(input, '键盘编辑候选');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('button', { name: candidateLabel('Author') }).textContent).toBe('林青');
    expect(f.apply).not.toHaveBeenCalled();
    await page.screenshot({
      path: '../../../../../.glossa-dev/qa/metadata-recognition-coarse-eink.png',
    });
  },
);
