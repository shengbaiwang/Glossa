import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import Button from '@/components/Button';

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: {} }) }));
afterEach(cleanup);

describe('reader toolbar button semantics', () => {
  it('exposes native disabled state and cannot invoke its action', () => {
    const onClick = vi.fn();
    render(<Button icon={<span />} label='Next page' disabled onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'Next page' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('exposes toggle and disclosure states to assistive technology', () => {
    render(
      <Button
        icon={<span />}
        label='Contents'
        onClick={vi.fn()}
        aria-pressed={true}
        aria-expanded={true}
        aria-controls='contents'
      />,
    );
    const button = screen.getByRole('button', { name: 'Contents', pressed: true, expanded: true });
    expect(button.getAttribute('aria-controls')).toBe('contents');
    expect(button.getAttribute('type')).toBe('button');
  });
});
