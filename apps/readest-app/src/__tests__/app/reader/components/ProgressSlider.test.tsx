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
  it('keeps native input as preview after pointer capture is lost, and navigates only on change', () => {
    const { slider, onCommit } = setup();
    pointer(slider, 'pointerdown');
    fireEvent.input(slider, { target: { value: '40' } });
    pointer(slider, 'lostpointercapture');
    fireEvent.input(slider, { target: { value: '65' } });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.change(slider);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(65);
  });

  it('does not navigate for a thumb press when the native range rounds the current fraction', () => {
    const onCommit = vi.fn();
    render(<ProgressSlider value={(70 / 407) * 100} onCommit={onCommit} />);
    const slider = screen.getByRole<HTMLInputElement>('slider');
    Object.assign(slider, { setPointerCapture: vi.fn(), hasPointerCapture: () => false });
    pointer(slider, 'pointerdown');
    fireEvent.input(slider, { target: { value: '17.2' } });
    pointer(slider, 'pointerup');
    fireEvent.change(slider);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('lets the native range own capture and commits exactly once when release signals overlap', () => {
    const { slider, onCommit, setPointerCapture, releasePointerCapture } = setup();
    pointer(slider, 'pointerdown');
    fireEvent.input(slider, { target: { value: '65' } });
    expect(setPointerCapture).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    pointer(slider, 'pointerup');
    pointer(slider, 'lostpointercapture');
    fireEvent.change(slider);
    expect(releasePointerCapture).toHaveBeenCalledWith(7);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(65);
  });

  it('restores the committed position on pointer cancellation', () => {
    const { slider, onCommit } = setup();
    pointer(slider, 'pointerdown');
    fireEvent.input(slider, { target: { value: '90' } });
    pointer(slider, 'pointercancel');
    expect(slider.value).toBe('20');
    fireEvent.input(slider, { target: { value: '75' } });
    fireEvent.change(slider);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('Escape cancels without allowing the remaining held drag to navigate', () => {
    const { slider, onCommit } = setup();
    pointer(slider, 'pointerdown');
    fireEvent.input(slider, { target: { value: '90' } });
    fireEvent.keyDown(slider, { key: 'Escape' });
    expect(slider.value).toBe('20');
    fireEvent.input(slider, { target: { value: '75' } });
    pointer(slider, 'pointerup');
    fireEvent.change(slider);
    expect(slider.value).toBe('20');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('previews repeated keys, isolates native toolbar shortcuts, and commits on key release', () => {
    const { container, slider, onCommit } = setup();
    const toolbarKeyDown = vi.fn();
    container.addEventListener('keydown', toolbarKeyDown);
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    fireEvent.input(slider, { target: { value: '21' } });
    fireEvent.keyDown(slider, { key: 'ArrowRight', repeat: true });
    fireEvent.input(slider, { target: { value: '22' } });
    expect(onCommit).not.toHaveBeenCalled();
    expect(toolbarKeyDown).not.toHaveBeenCalled();
    fireEvent.keyUp(slider, { key: 'ArrowRight' });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(22);
  });

  it('ignores native per-key change events until the held key is released', () => {
    const { slider, onCommit } = setup();
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    fireEvent.input(slider, { target: { value: '21' } });
    fireEvent.change(slider);
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.keyUp(slider, { key: 'ArrowRight' });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(21);
  });

  it('restores the latest actual reading position when a hidden panel interrupts preview', () => {
    const { slider, onCommit, rerender } = setup();
    pointer(slider, 'pointerdown');
    fireEvent.input(slider, { target: { value: '90' } });
    rerender(<ProgressSlider value={30} onCommit={onCommit} />);
    expect(slider.value).toBe('90');
    rerender(<ProgressSlider value={30} active={false} onCommit={onCommit} />);
    expect(slider.value).toBe('30');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('supports assistive value changes without pointer or keyboard events', () => {
    const { slider, onCommit } = setup();
    fireEvent.input(slider, { target: { value: '50' } });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.change(slider);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(50);
  });
});
