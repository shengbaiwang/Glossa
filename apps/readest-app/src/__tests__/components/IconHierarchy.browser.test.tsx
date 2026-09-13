import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { LibraryBig, Search, Pencil, Copy, CloudSync } from '@/components/GlossaIcons';
import NumberInput from '@/components/settings/NumberInput';
import NavigationRow from '@/components/settings/primitives/NavigationRow';
import '@/styles/globals.css';
import '@/styles/glossa.css';
import '@/styles/glossa-library.css';
import '@/styles/glossa-reader.css';
import '@/styles/glossa-desktop.css';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-eink');
  document.documentElement.removeAttribute('dir');
});

it('keeps navigation, chrome, local actions and inline details distinct across themes', async () => {
  await page.viewport(760, 500);
  render(
    <main style={{ padding: 32, background: 'var(--glossa-surface)', color: 'var(--glossa-ink)' }}>
      <div className='glossa-library-header' style={{ display: 'flex', minHeight: 64, padding: 8 }}>
        <button className='glossa-icon-button' aria-label='Library navigation'>
          <LibraryBig />
        </button>
        <span>书库导航 · 20 / 32 / 12</span>
      </div>
      <div
        className='glossa-reader-header'
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 8 }}
      >
        <button className='glossa-icon-button' aria-label='Reading control'>
          <Search />
        </button>
        <span>阅读工具 · 18 / 32 / 11</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 8 }}>
        <button className='glossa-icon-button glossa-tool-icon' aria-label='Local action'>
          <Pencil />
        </button>
        <span>局部编辑 · 16 / 28 / 9</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 8 }}>
        <button className='glossa-icon-button glossa-detail-icon' aria-label='Inline action'>
          <Copy />
        </button>
        <span>行内辅助 · 14 / 24 / 8</span>
      </div>
      <section className='glossa-settings' style={{ maxWidth: 420, padding: 8 }}>
        <NumberInput label='字号' value={18} min={8} max={40} onChange={vi.fn()} />
        <NavigationRow title='云同步' icon={CloudSync} onClick={vi.fn()} />
      </section>
    </main>,
  );
  for (const theme of ['default-light', 'default-dark']) {
    document.documentElement.setAttribute('data-theme', theme);
    for (const [name, glyph, target, radius] of [
      ['Library navigation', 20, 32, 12],
      ['Reading control', 18, 32, 11],
      ['Local action', 16, 28, 9],
      ['Inline action', 14, 24, 8],
      ['Increase', 16, 28, 9],
    ] as const) {
      const control = screen.getByRole('button', { name });
      expect(control.getBoundingClientRect().width).toBe(target);
      expect(getComputedStyle(control).borderRadius).toBe(`${radius}px`);
      expect(control.querySelector('svg')!.getBoundingClientRect().width).toBe(glyph);
      control.focus();
      expect(getComputedStyle(control).outlineStyle).not.toBe('none');
    }
    await page.screenshot({ path: `../../../../../.glossa-dev/qa/icon-hierarchy-${theme}.png` });
  }
  document.documentElement.dir = 'rtl';
  document.documentElement.setAttribute('data-eink', 'true');
  await page.viewport(390, 500);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
  await page.screenshot({ path: '../../../../../.glossa-dev/qa/icon-hierarchy-rtl-eink.png' });
});
