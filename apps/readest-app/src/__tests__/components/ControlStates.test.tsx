import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import NumberInput from '@/components/settings/NumberInput';
import MenuItem from '@/components/MenuItem';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (size: number) => size }));
afterEach(cleanup);

it('makes disabled and boundary stepper actions unavailable to keyboard and pointer activation', () => {
  const onChange = vi.fn();
  const { rerender } = render(
    <NumberInput label='Size' value={10} min={10} max={20} onChange={onChange} />,
  );
  expect((screen.getByRole('button', { name: 'Decrease' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Decrease' }));
  expect(onChange).not.toHaveBeenCalled();
  rerender(<NumberInput label='Size' value={15} min={10} max={20} disabled onChange={onChange} />);
  expect((screen.getByRole('button', { name: 'Increase' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Increase' }));
  expect(onChange).not.toHaveBeenCalled();
});

it('exposes menu selection as a checked choice while actions remain ordinary menu items', () => {
  render(
    <>
      <MenuItem label='Pin' toggled />
      <MenuItem label='Import' />
    </>,
  );
  expect(
    screen.getByRole('menuitemcheckbox', { name: 'Pin - ON' }).getAttribute('aria-checked'),
  ).toBe('true');
  expect(screen.getByRole('menuitem', { name: 'Import' }).hasAttribute('aria-checked')).toBe(false);
});
