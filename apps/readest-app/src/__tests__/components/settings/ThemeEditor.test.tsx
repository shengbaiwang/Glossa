import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import ThemeEditor from '@/components/settings/theme/ThemeEditor';
import { CustomTheme, themes } from '@/styles/themes';
import { md5Fingerprint } from '@/utils/md5';

const customThemes: CustomTheme[] = [];

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (text: string) => text }));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { globalReadSettings: { customThemes } } }),
}));

const original: CustomTheme = {
  name: md5Fingerprint('Evening'),
  label: 'Evening',
  colors: {
    light: { fg: '#303030', bg: '#faf0d0', primary: '#415577' },
    dark: { fg: '#ddccbb', bg: '#252525', primary: '#aabbdd' },
  },
};

const mount = (customTheme: CustomTheme | null = null) => {
  const callbacks = { onSave: vi.fn(), onDelete: vi.fn(), onCancel: vi.fn() };
  const baseTheme = themes.find((theme) => theme.name === 'sepia')!;
  render(<ThemeEditor customTheme={customTheme} baseTheme={baseTheme} {...callbacks} />);
  return { ...callbacks, baseTheme };
};

beforeEach(() => customThemes.splice(0));
afterEach(() => cleanup());

describe('Glossa custom theme editor', () => {
  it('starts a new theme from the selected preset in both modes', () => {
    const { baseTheme, onSave } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({
      name: md5Fingerprint('Custom'),
      label: 'Custom',
      colors: {
        light: {
          fg: baseTheme.colors.light['base-content'],
          bg: baseTheme.colors.light['base-100'],
          primary: baseTheme.colors.light.primary,
        },
        dark: {
          fg: baseTheme.colors.dark['base-content'],
          bg: baseTheme.colors.dark['base-100'],
          primary: baseTheme.colors.dark.primary,
        },
      },
    });
  });

  it('discards edits on cancel without saving or deleting', () => {
    const { onSave, onDelete, onCancel } = mount(original);
    fireEvent.change(screen.getByPlaceholderText('Custom Theme'), {
      target: { value: 'Changed' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
    expect(original.label).toBe('Evening');
  });

  it('preserves the original identifier and colors when renaming an existing theme', () => {
    customThemes.push(original);
    const { onSave } = mount(original);
    fireEvent.change(screen.getByPlaceholderText('Custom Theme'), {
      target: { value: '  Quiet evening  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({ ...original, label: 'Quiet evening' });
  });

  it('blocks duplicate labels instead of overwriting an existing theme', () => {
    customThemes.push(original);
    const { onSave, onDelete } = mount();
    fireEvent.change(screen.getByPlaceholderText('Custom Theme'), {
      target: { value: ' evening ' },
    });
    expect(screen.getByRole('alert').textContent).toBe('A theme with this name already exists.');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText('Custom Theme'), {
      target: { value: 'Morning' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('blocks reuse of a renamed theme identifier when creating a new theme', () => {
    customThemes.push({ ...original, label: 'Renamed evening' });
    const { onSave } = mount();
    fireEvent.change(screen.getByPlaceholderText('Custom Theme'), {
      target: { value: 'Evening' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('deletes only the original theme even when its draft name matches another theme', () => {
    customThemes.push(original, { ...original, name: md5Fingerprint('Morning'), label: 'Morning' });
    const { onDelete, onSave } = mount(original);
    fireEvent.change(screen.getByPlaceholderText('Custom Theme'), {
      target: { value: 'Morning' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledWith(original);
  });

  it('requires a nonempty theme name', () => {
    const { onSave } = mount();
    fireEvent.change(screen.getByPlaceholderText('Custom Theme'), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Theme Name' }).getAttribute('aria-invalid')).toBe(
      'true',
    );
  });

  it('keeps a failed save draft available for retry and disables actions while saving', async () => {
    let rejectSave: (reason: Error) => void = () => {};
    const onSave = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectSave = reject;
          }),
      )
      .mockResolvedValue(undefined);
    const onCancel = vi.fn();
    render(
      <ThemeEditor customTheme={original} onSave={onSave} onDelete={vi.fn()} onCancel={onCancel} />,
    );
    fireEvent.change(screen.getByPlaceholderText('Custom Theme'), {
      target: { value: 'Draft name' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    for (const name of ['Save', 'Delete', 'Cancel']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
    await act(async () => rejectSave(new Error('storage unavailable')));
    expect(screen.getByRole('alert').textContent).toBe('Could not save the theme. Try again.');
    expect((screen.getByRole('textbox', { name: 'Theme Name' }) as HTMLInputElement).value).toBe(
      'Draft name',
    );
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save' })));
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenLastCalledWith({ ...original, label: 'Draft name' });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('retains the original delete target after a failed asynchronous deletion', async () => {
    const onDelete = vi
      .fn()
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValue(undefined);
    const onCancel = vi.fn();
    render(
      <ThemeEditor
        customTheme={original}
        onSave={vi.fn()}
        onDelete={onDelete}
        onCancel={onCancel}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText('Custom Theme'), {
      target: { value: 'Unsaved rename' },
    });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Delete' })));
    expect(screen.getByRole('alert').textContent).toBe('Could not delete the theme. Try again.');
    expect(onCancel).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Delete' })));
    expect(onDelete).toHaveBeenCalledTimes(2);
    expect(onDelete).toHaveBeenLastCalledWith(original);
  });
});
