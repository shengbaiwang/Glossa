import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FormField } from '@/components/metadata/FormField';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
afterEach(cleanup);

it('associates a field with its label, validation error and named lock control', () => {
  const toggle = vi.fn();
  render(
    <FormField
      field='isbn'
      label='ISBN'
      value='invalid'
      fieldSources={{}}
      lockedFields={{}}
      fieldErrors={{ isbn: 'Invalid ISBN' }}
      onFieldChange={vi.fn()}
      onToggleFieldLock={toggle}
    />,
  );
  const input = screen.getByRole('textbox', { name: 'ISBN' });
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toContain(
    'Invalid ISBN',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Lock field: ISBN' }));
  expect(toggle).toHaveBeenCalledWith('isbn');
});

it('keeps a locked field readable and exposes the unlock action', () => {
  render(
    <FormField
      field='description'
      label='Description'
      type='textarea'
      value='Original description'
      fieldSources={{}}
      lockedFields={{ description: true }}
      fieldErrors={{}}
      onFieldChange={vi.fn()}
      onToggleFieldLock={vi.fn()}
    />,
  );
  expect(
    (screen.getByRole('textbox', { name: 'Description' }) as HTMLTextAreaElement).disabled,
  ).toBe(true);
  expect(
    screen.getByRole('button', { name: 'Unlock field: Description' }).getAttribute('aria-pressed'),
  ).toBe('true');
});
