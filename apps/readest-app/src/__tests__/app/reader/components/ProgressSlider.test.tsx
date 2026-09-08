import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProgressSlider from '@/app/reader/components/footerbar/ProgressSlider';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
afterEach(cleanup);

const pointer = (element: HTMLElement, type: string) => {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, 'pointerId', { value: 7 });
  fireEvent(element, event);
};

const setup = () => {
  const onCommit = vi.fn();
  const rendered = render(<ProgressSlider value={20} onCommit={onCommit} />);
  const slider = screen.getByRole<HTMLInputElement>('slider');
  const setPointerCapture = vi.fn();
  const releasePointerCapture = vi.fn();
  Object.assign(slider, {
    setPointerCapture,
    releasePointerCapture,
    hasPointerCapture: () => true,
  });
  return { ...rendered, onCommit, slider, setPointerCapture, releasePointerCapture };
};

describe('progress slider commit and cancellation', () => {
  it('captures the drag and commits exactly once even when capture is released afterwards', () => {
    const { slider, onCommit, setPointerCapture, releasePointerCapture } = setup();
    pointer(slider, 'pointerdown');
    fireEvent.change(slider, { target: { value: '65' } });
    expect(setPointerCapture).toHaveBeenCalledWith(7);
    expect(onCommit).not.toHaveBeenCalled();
    pointer(slider, 'pointerup');
    pointer(slider, 'lostpointercapture');
    expect(releasePointerCapture).toHaveBeenCalledWith(7);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(65);
  });

  it.each([
    'pointercancel',
    'lostpointercapture',
  ])('restores the committed position on %s', (event) => {
    const { slider, onCommit } = setup();
    pointer(slider, 'pointerdown');
    fireEvent.change(slider, { target: { value: '90' } });
    pointer(slider, event);
    expect(slider.value).toBe('20');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('Escape cancels without allowing the remaining held drag to navigate', () => {
    const { slider, onCommit } = setup();
    pointer(slider, 'pointerdown');
    fireEvent.change(slider, { target: { value: '90' } });
    fireEvent.keyDown(slider, { key: 'Escape' });
    expect(slider.value).toBe('20');
    fireEvent.change(slider, { target: { value: '75' } });
    pointer(slider, 'pointerup');
    expect(slider.value).toBe('20');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('previews repeated keys, isolates native toolbar shortcuts, and commits on key release', () => {
    const { container, slider, onCommit } = setup();
    const toolbarKeyDown = vi.fn();
    container.addEventListener('keydown', toolbarKeyDown);
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    fireEvent.change(slider, { target: { value: '21' } });
    fireEvent.keyDown(slider, { key: 'ArrowRight', repeat: true });
    fireEvent.change(slider, { target: { value: '22' } });
    expect(onCommit).not.toHaveBeenCalled();
    expect(toolbarKeyDown).not.toHaveBeenCalled();
    fireEvent.keyUp(slider, { key: 'ArrowRight' });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(22);
  });

  it('restores the latest actual reading position when a hidden panel interrupts preview', () => {
    const { slider, onCommit, rerender } = setup();
    pointer(slider, 'pointerdown');
    fireEvent.change(slider, { target: { value: '90' } });
    rerender(<ProgressSlider value={30} onCommit={onCommit} />);
    expect(slider.value).toBe('90');
    rerender(<ProgressSlider value={30} active={false} onCommit={onCommit} />);
    expect(slider.value).toBe('30');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('supports assistive value changes without pointer or keyboard events', () => {
    const { slider, onCommit } = setup();
    fireEvent.change(slider, { target: { value: '50' } });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(50);
  });
});
