import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import FontPicker from '@/components/settings/FontPicker';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (text: string) => text }));
vi.mock('@/hooks/useKeyDownActions', () => ({ useKeyDownActions: vi.fn() }));

const options = [
  { option: 'SimSun', label: '宋体' },
  { option: 'KaiTi', label: '楷体' },
  { option: 'MyFont', label: 'Imported Font' },
];
const getFontFamily = (option: string) => `"${option}", serif`;
const props = {
  label: 'Chinese Font',
  selected: 'SimSun',
  options,
  onSelect: vi.fn(),
  onGetFontFamily: getFontFamily,
  language: 'zh-CN',
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('font picker', () => {
  it('expands in place with equal samples rendered using each actual font', () => {
    render(<FontPicker {...props} data-setting-id='settings.font.cjkFont' />);
    const trigger = screen.getByRole('button', { name: 'Chinese Font: 宋体' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('searchbox'));
    expect(screen.getAllByText('微雨从东来，好风与之俱')).toHaveLength(options.length);
    for (const { option, label } of options) {
      const button = screen.getByRole('button', { name: label });
      expect(button.tagName).toBe('BUTTON');
      expect(button.getAttribute('aria-pressed')).toBe(String(option === 'SimSun'));
      const sample = within(button).getByText('微雨从东来，好风与之俱');
      expect(sample.style.fontFamily).toBe(getFontFamily(option));
      expect(sample.lang).toBe('zh-Hans');
    }
  });

  it('searches localized names and original family names without nested menus', () => {
    render(<FontPicker {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Chinese Font: 宋体' }));
    const search = screen.getByRole('searchbox', { name: 'Search Fonts' });
    fireEvent.change(search, { target: { value: ' kAiTi ' } });
    expect(screen.getByRole('button', { name: '楷体' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '宋体' })).toBeNull();
    fireEvent.change(search, { target: { value: '宋' } });
    expect(screen.getByRole('button', { name: '宋体' })).toBeTruthy();
    fireEvent.change(search, { target: { value: 'missing font' } });
    expect(screen.getByRole('status').textContent).toBe('No matching fonts');
  });

  it('selects once, closes, and returns focus to the trigger', () => {
    render(<FontPicker {...props} />);
    const trigger = screen.getByRole('button', { name: 'Chinese Font: 宋体' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: '楷体' }));
    expect(props.onSelect).toHaveBeenCalledExactlyOnceWith('KaiTi');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
    expect(screen.queryByRole('searchbox')).toBeNull();
    fireEvent.click(trigger);
    expect(screen.getByRole<HTMLInputElement>('searchbox').value).toBe('');
  });

  it('lets keyboard users browse options and consumes Escape before settings can close', () => {
    const onSettingsKeyDown = vi.fn();
    render(
      <div onKeyDown={onSettingsKeyDown}>
        <FontPicker {...props} />
      </div>,
    );
    const trigger = screen.getByRole('button', { name: 'Chinese Font: 宋体' });
    fireEvent.click(trigger);
    const search = screen.getByRole('searchbox');
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '宋体' }));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '楷体' }));
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Imported Font' }));
    onSettingsKeyDown.mockClear();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(onSettingsKeyDown).not.toHaveBeenCalled();
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps Arabic sample direction independent of the surrounding interface', () => {
    render(<FontPicker {...props} language='ar' />);
    fireEvent.click(screen.getByRole('button', { name: 'Chinese Font: 宋体' }));
    const sample = screen.getByRole('button', { name: '宋体' }).querySelector('[lang]');
    expect(sample?.getAttribute('dir')).toBe('rtl');
    expect(sample?.getAttribute('lang')).toBe('ar');
  });

  it('preserves an unavailable selection and handles an empty list without crashing', () => {
    render(<FontPicker {...props} options={[]} selected='Imported Font' />);
    fireEvent.click(screen.getByRole('button', { name: 'Chinese Font: Imported Font' }));
    expect(screen.getByRole('status').textContent).toBe('No matching fonts');
  });
});
