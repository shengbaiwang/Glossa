import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { useState } from 'react';
import Alert from '@/components/Alert';
import MenuItem from '@/components/MenuItem';
import BoxedList from '@/components/settings/primitives/BoxedList';
import SettingsRow from '@/components/settings/primitives/SettingsRow';
import SettingsInput from '@/components/settings/primitives/SettingsInput';
import SettingsSelect from '@/components/settings/primitives/SettingsSelect';
import SettingsSwitchRow from '@/components/settings/primitives/SettingsSwitchRow';
import NavigationRow from '@/components/settings/primitives/NavigationRow';
import { CloudSync } from '@/components/GlossaIcons';
import { Input } from '@/components/primitives/input';
import Slider from '@/components/Slider';
import { Button } from '@/components/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/primitives/dialog';
import '@/styles/globals.css';
import '@/styles/glossa.css';
import '@/styles/glossa-library.css';
import '@/styles/glossa-reader.css';
import '@/styles/glossa-desktop.css';

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: null }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (size: number) => size }));
afterEach(() => {
  cleanup();
  for (const attr of ['data-theme', 'data-eink', 'dir', 'data-page'])
    document.documentElement.removeAttribute(attr);
});
function SettingsFixture() {
  const [checked, setChecked] = useState(true);
  return (
    <main
      className='settings-content'
      style={{ padding: 24, maxWidth: 620, background: 'var(--glossa-surface)' }}
    >
      <h2 className='glossa-dialog-title' style={{ marginBottom: 24 }}>
        阅读设置
      </h2>
      <BoxedList title='排版与显示'>
        <SettingsRow label='翻页方式' description='跟随当前书籍'>
          <SettingsSelect
            ariaLabel='翻页方式'
            value='scroll'
            onChange={vi.fn()}
            options={[{ value: 'scroll', label: '连续滚动' }]}
          />
        </SettingsRow>
        <SettingsRow label='用户名'>
          <SettingsInput aria-label='用户名' defaultValue='Reader' />
        </SettingsRow>
        <SettingsSwitchRow
          label='显示进度'
          checked={checked}
          onChange={() => setChecked(!checked)}
        />
        <NavigationRow title='云同步' status='已连接' icon={CloudSync} onClick={vi.fn()} />
      </BoxedList>
      <div style={{ marginBlock: 24, display: 'grid', gap: 12 }}>
        <label>
          书籍名称
          <Input aria-label='书籍名称' placeholder='输入名称' />
        </label>
        <Slider label='亮度' initialValue={65} minLabel='暗' maxLabel='亮' bubbleLabel='65' />
      </div>
      <div className='glossa-menu-surface' role='menu' aria-label='阅读菜单'>
        <MenuItem label='固定侧栏' toggled />
        <MenuItem label='导入文件' shortcut='⌘O' />
        <hr className='glossa-menu-separator' />
        <MenuItem label='不可用操作' disabled />
      </div>
    </main>
  );
}
it('shares typography, menu geometry and visible keyboard focus without flattening settings rows', async () => {
  await page.viewport(1100, 850);
  render(<SettingsFixture />);
  for (const theme of ['default-light', 'default-dark']) {
    document.documentElement.setAttribute('data-theme', theme);
    const select = screen.getByRole('combobox', { name: '翻页方式' });
    expect(getComputedStyle(select).height).toBe('36px');
    expect(select.closest('.glossa-settings-row')!.getBoundingClientRect().height).toBe(56);
    const title = screen.getByRole('heading', { name: '阅读设置' });
    expect(getComputedStyle(title).fontSize).toBe('16px');
    expect(getComputedStyle(screen.getByRole('heading', { name: '排版与显示' })).fontSize).toBe(
      '12px',
    );
    const menu = screen.getByRole('menuitem', { name: /导入文件/ });
    expect(getComputedStyle(menu).fontSize).toBe('14px');
    expect(getComputedStyle(menu).minHeight).toBe('36px');
    expect(getComputedStyle(menu).borderRadius).toBe('9px');
    select.focus();
    expect(getComputedStyle(select.parentElement!).outlineStyle).toBe('solid');
    const valueInput = screen.getByRole('textbox', { name: '用户名' });
    valueInput.focus();
    expect(getComputedStyle(valueInput).outlineWidth).toBe('2px');
    const field = screen.getByRole('textbox', { name: '书籍名称' });
    field.focus();
    expect(getComputedStyle(field).outlineWidth).toBe('2px');
    expect(getComputedStyle(field).borderRadius).toBe('9px');
    const slider = screen.getByRole('slider');
    slider.focus();
    expect(getComputedStyle(slider.closest('.glossa-slider')!).outlineStyle).toBe('solid');
    const disabled = screen.getByRole('menuitem', { name: '不可用操作' });
    expect((disabled as HTMLButtonElement).disabled).toBe(true);
    expect(getComputedStyle(disabled).opacity).toBe('0.45');
    const choice = screen.getByRole('menuitemcheckbox');
    const selectedBackground = getComputedStyle(choice).backgroundColor;
    await page.getByRole('menuitemcheckbox').hover();
    expect(getComputedStyle(choice).backgroundColor).toBe(selectedBackground);
    await page.screenshot({
      path: `../../../../../.glossa-dev/qa/design-foundations-${theme}.png`,
    });
  }
  document.documentElement.dir = 'rtl';
  document.documentElement.setAttribute('data-eink', 'true');
  await page.viewport(390, 850);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
  expect(getComputedStyle(screen.getByRole('menu')).boxShadow).toBe('none');
  expect(getComputedStyle(screen.getByRole('menuitemcheckbox')).outlineStyle).toBe('solid');
  await page.screenshot({ path: '../../../../../.glossa-dev/qa/design-foundations-rtl-eink.png' });
});
it('keeps dialogs elevated above menus with aligned actions and a reachable close control', async () => {
  await page.viewport(900, 650);
  document.documentElement.setAttribute('data-theme', 'default-dark');
  render(
    <Dialog defaultOpen>
      <DialogContent>
        <DialogTitle>编辑书籍</DialogTitle>
        <DialogDescription>书籍信息</DialogDescription>
        <Input aria-label='标题' defaultValue='阅读与思考' />
        <DialogFooter>
          <Button variant='ghost'>取消</Button>
          <Button>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>,
  );
  const dialog = screen.getByRole('dialog');
  expect(getComputedStyle(dialog).borderRadius).toBe('20px');
  expect(getComputedStyle(dialog).padding).toBe('24px');
  expect(getComputedStyle(screen.getByRole('heading')).fontSize).toBe('16px');
  expect(getComputedStyle(screen.getByRole('button', { name: '保存' })).minHeight).toBe('36px');
  await page.screenshot({ path: '../../../../../.glossa-dev/qa/design-foundations-dialog.png' });
});

it('gives confirmation dialogs the same title and action geometry while preserving destructive intent', async () => {
  await page.viewport(760, 500);
  document.documentElement.setAttribute('data-theme', 'default-light');
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  render(
    <Alert
      title='删除书籍'
      message='确认删除这本书？'
      confirmLabel='删除'
      confirmButtonClassName='btn-error'
      onCancel={onCancel}
      onConfirm={onConfirm}
    />,
  );
  expect(getComputedStyle(screen.getByRole('alert')).borderRadius).toBe('20px');
  expect(getComputedStyle(screen.getByRole('heading')).fontSize).toBe('16px');
  const confirm = screen.getByRole('button', { name: '删除' });
  expect(confirm.classList.contains('btn-error')).toBe(true);
  await page.getByRole('button', { name: 'Cancel' }).click();
  expect(onCancel).toHaveBeenCalledOnce();
  expect(onConfirm).not.toHaveBeenCalled();
});
