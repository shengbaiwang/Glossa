import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { CircleUserRound } from '@/components/GlossaIcons';
import BoxedList from '@/components/settings/primitives/BoxedList';
import NavigationRow from '@/components/settings/primitives/NavigationRow';
import SettingsSwitchRow from '@/components/settings/primitives/SettingsSwitchRow';
import SettingsRow from '@/components/settings/primitives/SettingsRow';
import '@/styles/globals.css';
import '@/styles/glossa.css';

const fixtures = [
  { theme: 'default-light', dir: 'ltr', eink: false, width: 760 },
  { theme: 'default-dark', dir: 'ltr', eink: false, width: 760 },
  { theme: 'default-light', dir: 'rtl', eink: false, width: 390 },
  { theme: 'default-dark', dir: 'rtl', eink: true, width: 390 },
] as const;

afterEach(() => {
  cleanup();
  for (const name of ['data-theme', 'dir', 'data-eink'])
    document.documentElement.removeAttribute(name);
});

it.each(fixtures)('covers the whole setting row in $theme / $dir / eink=$eink', async (fixture) => {
  await page.viewport(fixture.width, 700);
  document.documentElement.setAttribute('data-theme', fixture.theme);
  document.documentElement.dir = fixture.dir;
  document.documentElement.setAttribute('data-eink', String(fixture.eink));
  const navigate = vi.fn();
  const toggle = vi.fn();
  const view = render(
    <main className='settings-content bg-base-200 text-base-content min-h-screen space-y-6 p-6'>
      <button type='button'>Before settings</button>
      <BoxedList title='账户'>
        <NavigationRow title='登录' icon={CircleUserRound} onClick={navigate} />
      </BoxedList>
      <BoxedList title='其他设置'>
        <NavigationRow title='顶部' onClick={navigate} />
        <SettingsSwitchRow label='开关' checked={false} onChange={toggle} />
        <NavigationRow title='禁用' onClick={navigate} disabled />
        <NavigationRow title='底部' onClick={navigate} />
      </BoxedList>
      <BoxedList>
        <SettingsRow label='浮层'>
          <span data-testid='popover' style={{ position: 'absolute', top: '100%' }}>
            浮层内容
          </span>
        </SettingsRow>
      </BoxedList>
    </main>,
  );
  const login = screen.getByRole('button', { name: '登录' });
  login.style.transition = 'none';
  const card = login.closest('.glossa-group-card')!;
  const cardRect = card.getBoundingClientRect();
  const border = parseFloat(getComputedStyle(card).borderInlineStartWidth);
  for (const row of view.container.querySelectorAll('.glossa-settings-row')) {
    const group = row.closest('.glossa-group-card')!;
    const outer = group.getBoundingClientRect();
    const inner = row.getBoundingClientRect();
    const inset = parseFloat(getComputedStyle(group).borderInlineStartWidth);
    expect(inner.left - outer.left).toBeCloseTo(inset, 1);
    expect(outer.right - inner.right).toBeCloseTo(inset, 1);
    expect(getComputedStyle(row).paddingInlineStart).toBe('16px');
  }
  // The former dead strip is part of the actual hit target, in either direction.
  const point = {
    x: fixture.dir === 'rtl' ? cardRect.right - border - 4 : cardRect.left + border + 4,
    y: cardRect.top + cardRect.height / 2,
  };
  expect(document.elementFromPoint(point.x, point.y)?.closest('button')).toBe(login);
  await userEvent.hover(login);
  expect(getComputedStyle(login).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  const hoverColor = getComputedStyle(login).backgroundColor;
  let pressedColor = '';
  login.addEventListener(
    'mousedown',
    () => {
      expect(login.matches(':active')).toBe(true);
      pressedColor = getComputedStyle(login).backgroundColor;
    },
    { once: true },
  );
  const radius = getComputedStyle(card).borderStartStartRadius;
  expect(getComputedStyle(login).borderStartStartRadius).toBe(radius);
  expect(getComputedStyle(login).borderEndStartRadius).toBe(radius);
  const top = screen.getByRole('button', { name: '顶部' });
  const bottom = screen.getByRole('button', { name: '底部' });
  expect(getComputedStyle(top).borderEndStartRadius).toBe('0px');
  expect(getComputedStyle(bottom).borderStartStartRadius).toBe('0px');
  expect(getComputedStyle(bottom).borderEndStartRadius).toBe(radius);
  expect(getComputedStyle(bottom, '::before').insetInlineStart).toBe('16px');
  await page.getByRole('button', { name: '登录', exact: true }).click({
    position: { x: fixture.dir === 'rtl' ? login.clientWidth - 4 : 4, y: 32 },
  });
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(pressedColor).not.toBe('');
  expect(pressedColor).not.toBe(hoverColor);
  await userEvent.click(screen.getByRole('button', { name: 'Before settings' }));
  await userEvent.tab();
  expect(document.activeElement).toBe(login);
  expect(login.matches(':focus-visible')).toBe(true);
  expect(getComputedStyle(login).outlineStyle).toBe('solid');
  await userEvent.keyboard('{Enter}');
  expect(navigate).toHaveBeenCalledTimes(2);
  const switchRow = screen.getByText('开关').closest('label')!;
  await userEvent.click(switchRow, { position: { x: 4, y: 20 } });
  expect(toggle).toHaveBeenCalledTimes(1);
  const disabled = screen.getByRole('button', { name: '禁用' });
  await userEvent.hover(disabled);
  expect(getComputedStyle(disabled).backgroundColor).toBe('rgba(0, 0, 0, 0)');
  for (const ancestor of [card, card.firstElementChild!])
    expect(getComputedStyle(ancestor).overflow).toBe('visible');
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  await userEvent.hover(login);
  await page.screenshot({
    path: `../../../../../../.glossa-dev/qa/settings-rows-${fixture.theme}-${fixture.dir}-${fixture.eink}.png`,
  });
});
