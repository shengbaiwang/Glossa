import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ReadingRulerSettings from '@/components/settings/theme/ReadingRulerSettings';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

describe('ReadingRulerSettings transparency', () => {
  it('shows and saves transparency directly', () => {
    const onTransparencyChange = vi.fn();
    render(
      <ReadingRulerSettings
        enabled
        lines={2}
        transparency={0.3}
        color='transparent'
        onEnabledChange={() => {}}
        onLinesChange={() => {}}
        onTransparencyChange={onTransparencyChange}
        onColorChange={() => {}}
      />,
    );

    const input = screen.getByRole('textbox', { name: 'Transparency' });
    expect((input as HTMLInputElement).value).toBe('0.3');

    fireEvent.change(input, { target: { value: '0.8' } });
    fireEvent.blur(input);
    expect(onTransparencyChange).toHaveBeenCalledExactlyOnceWith(0.8);
  });
});
