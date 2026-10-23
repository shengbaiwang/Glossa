import { afterEach, describe, expect, it } from 'vitest';
import { applyImageStyle } from '@/utils/style';

afterEach(() => {
  document.body.innerHTML = '';
});

const svgPage = (extra = '') => {
  document.body.innerHTML = `<div><svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 1973 2751" preserveAspectRatio="none"><title>Cover</title><image width="1973" height="2751" href="cover.jpg"/></svg></div>${extra}`;
  return document.querySelector('svg')!;
};

describe('reader image pages', () => {
  it('keeps relative image dimensions responsive to their own reading frame', () => {
    document.body.innerHTML = '<p>Text <img width="75%" height="50vh"></p>';
    applyImageStyle(document);
    const img = document.querySelector('img')!;
    expect(img.style.width).toBe('75%');
    expect(img.style.height).toBe('calc(0.5 * var(--glossa-page-height, 100vh))');
  });

  it('fits an isolated raster-backed SVG by its viewBox without stretching', () => {
    const svg = svgPage();
    applyImageStyle(document);
    expect(svg.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
    expect(svg.classList.contains('glossa-image-page')).toBe(true);
    expect(Number(svg.style.getPropertyValue('--glossa-image-ratio'))).toBeCloseTo(1973 / 2751);
  });

  it('preserves diagrams, text illustrations and fixed layout artwork', () => {
    const svg = svgPage('<p>Text accompanying the illustration.</p>');
    applyImageStyle(document);
    expect(svg.getAttribute('preserveAspectRatio')).toBe('none');
    svgPage();
    document
      .querySelector('svg')!
      .append(document.createElementNS('http://www.w3.org/2000/svg', 'path'));
    applyImageStyle(document);
    expect(document.querySelector('svg')!.getAttribute('preserveAspectRatio')).toBe('none');
    const fixed = svgPage();
    applyImageStyle(document, true);
    expect(fixed.getAttribute('preserveAspectRatio')).toBe('none');
  });
});
