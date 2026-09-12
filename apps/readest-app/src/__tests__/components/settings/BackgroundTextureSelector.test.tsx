import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';

/**
 * The Background Image picker is linked by default (no scope switcher). The
 * Library|Reader switcher only appears once the user turns on the separate
 * reader background toggle.
 */

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

import BackgroundTextureSelector from '@/components/settings/theme/BackgroundTextureSelector';

afterEach(() => cleanup());

const baseProps = {
  predefinedTextures: [{ id: 'none' }, { id: 'paper', url: '/textures/paper.png' }],
  customTextures: [],
  separateReader: false,
  scope: 'library' as const,
  selectedTextureId: 'none',
  backgroundTransparency: 0.4,
  backgroundSize: 'cover',
  onSeparateReaderChange: vi.fn(),
  onScopeChange: vi.fn(),
  onTextureSelect: vi.fn(),
  onTransparencyChange: vi.fn(),
  onSizeChange: vi.fn(),
  onImportImage: vi.fn(),
  onDeleteTexture: vi.fn(),
};

describe('BackgroundTextureSelector transparency', () => {
  it.each([
    [0.45, 45],
    [0, 0],
    [1, 100],
  ])('displays saved transparency %s as %s percent without changing it', (backgroundTransparency, transparency) => {
    const onTransparencyChange = vi.fn();
    render(
      <BackgroundTextureSelector
        {...baseProps}
        selectedTextureId='paper'
        backgroundTransparency={backgroundTransparency}
        onTransparencyChange={onTransparencyChange}
      />,
    );
    expect((screen.getByRole('slider', { name: 'Transparency' }) as HTMLInputElement).value).toBe(
      String(transparency),
    );
    expect(screen.getByText(`${transparency}%`)).not.toBeNull();
    expect(onTransparencyChange).not.toHaveBeenCalled();
  });

  it.each([
    [0, 0],
    [75, 0.75],
    [100, 1],
  ])('saves %s percent transparency as %s', (transparency, savedTransparency) => {
    const onTransparencyChange = vi.fn();
    render(
      <BackgroundTextureSelector
        {...baseProps}
        selectedTextureId='paper'
        onTransparencyChange={onTransparencyChange}
      />,
    );
    fireEvent.change(screen.getByRole('slider', { name: 'Transparency' }), {
      target: { value: String(transparency) },
    });
    expect(onTransparencyChange).toHaveBeenCalledExactlyOnceWith(savedTransparency);
  });

  it('hides transparency when no background is selected', () => {
    render(<BackgroundTextureSelector {...baseProps} />);
    expect(screen.queryByRole('slider', { name: 'Transparency' })).toBeNull();
  });
});

describe('BackgroundTextureSelector separate reader toggle', () => {
  it('offers the separate reader background switch', () => {
    const onSeparateReaderChange = vi.fn();
    render(
      <BackgroundTextureSelector {...baseProps} onSeparateReaderChange={onSeparateReaderChange} />,
    );

    fireEvent.click(screen.getByRole('checkbox'));
    expect(onSeparateReaderChange).toHaveBeenCalledWith(true);
  });

  it('hides the Library|Reader switcher while linked', () => {
    render(<BackgroundTextureSelector {...baseProps} separateReader={false} />);

    expect(screen.queryByRole('radiogroup', { name: 'Background Image' })).toBeNull();
  });

  it('shows the Library|Reader switcher when separate', () => {
    render(<BackgroundTextureSelector {...baseProps} separateReader scope='reader' />);

    expect(screen.getByRole('radiogroup', { name: 'Background Image' })).not.toBeNull();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.getByRole('radio', { name: 'Reader' }).getAttribute('aria-checked')).toBe('true');
  });

  it('fires onScopeChange with the clicked scope', () => {
    const onScopeChange = vi.fn();
    render(
      <BackgroundTextureSelector {...baseProps} separateReader onScopeChange={onScopeChange} />,
    );

    fireEvent.click(screen.getByRole('radio', { name: 'Reader' }));
    expect(onScopeChange).toHaveBeenCalledWith('reader');
  });
});
