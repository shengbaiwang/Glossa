import { useState } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import ProgressSlider from '@/app/reader/components/footerbar/ProgressSlider';
import '@/styles/globals.css';
import '@/styles/glossa.css';
import '@/styles/glossa-reader.css';
import '@/styles/glossa-reader-navigation.css';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
afterEach(cleanup);

it.each([
  'ltr',
  'rtl',
])('keeps native %s dragging local and commits only the final position once', async (dir) => {
  await page.viewport(1200, 820);
  let held = false;
  const commits: number[] = [];
  const events: boolean[] = [];
  const trace: string[] = [];
  const Fixture = () => {
    const [value, setValue] = useState((70 / 407) * 100);
    return (
      <div
        dir={dir}
        style={{ width: 600, margin: 30 }}
        onPointerDown={() => {
          held = true;
        }}
        onPointerUpCapture={() => {
          held = false;
        }}
      >
        <ProgressSlider
          value={value}
          onCommit={(next) => {
            expect(held).toBe(false);
            commits.push(next);
            // Reader relocation acknowledges the committed position asynchronously.
            setTimeout(() => setValue(next), 50);
          }}
        />
      </div>
    );
  };
  render(<Fixture />);
  const slider = screen.getByRole<HTMLInputElement>('slider');
  await userEvent.hover(slider);
  slider.addEventListener('input', (event) => events.push(event.isTrusted));
  for (const type of [
    'pointerdown',
    'pointerup',
    'pointercancel',
    'lostpointercapture',
    'input',
    'change',
    'blur',
  ]) {
    slider.addEventListener(type, () => trace.push(`${type}:${slider.value}`));
  }
  const rect = slider.getBoundingClientRect();
  const x = (fraction: number) =>
    rect.left +
    11 +
    (rect.width - 22) * (getComputedStyle(slider).direction === 'rtl' ? 1 - fraction : fraction);
  await commands.dragPDFText(
    { x: x(70 / 407), y: rect.top + rect.height / 2 },
    { x: x(0.7), y: rect.top + rect.height / 2 },
    100,
    { x: x(0.9), y: rect.top + rect.height / 2 },
  );
  expect(
    commits.length,
    JSON.stringify({ trace, rect: rect.toJSON(), direction: getComputedStyle(slider).direction }),
  ).toBe(1);
  expect(commits[0]).toBeCloseTo(70, 0);
  expect(events.length).toBeGreaterThan(8);
  expect(events.every(Boolean)).toBe(true);
  await expect.poll(() => Number(slider.value)).toBeCloseTo(70, 0);
});
