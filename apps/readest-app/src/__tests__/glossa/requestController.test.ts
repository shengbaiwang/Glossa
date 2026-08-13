import { describe, expect, test } from 'vitest';

import { GlossaRequestController, MockProvider } from '@/glossa/ai';
import { createContextPack } from '@/glossa/context/contextPack';
import type { SourceSegment } from '@/glossa/context/types';

const segment = (text: string, cfi: string): SourceSegment => ({
  text,
  anchor: {
    version: 1,
    documentId: 'fixture-book',
    format: 'epub',
    sectionId: 'chapter-1.xhtml',
    cfi,
    quote: { exact: text },
  },
});

const makePack = (text: string) => {
  const selected = segment(text, `epubcfi(/6/2!/4/${text.length}:0)`);
  return createContextPack({ selection: selected, selectionContext: [selected] });
};

describe('GlossaRequestController', () => {
  test('replaces an unfinished request so its remaining output cannot overwrite the newer answer', async () => {
    const controller = new GlossaRequestController(new MockProvider());
    const first = { text: '', completed: 0, cancelled: 0 };
    const second = { text: '', completed: 0 };
    const initial = controller.run(
      { action: 'explain', contextPack: makePack('first selection') },
      {
        onText: (text) => (first.text += text),
        onComplete: () => first.completed++,
        onCancelled: () => first.cancelled++,
        onError: () => {},
      },
    );
    await Promise.resolve();
    const replacement = controller.run(
      { action: 'translate', contextPack: makePack('second selection') },
      {
        onText: (text) => (second.text += text),
        onComplete: () => second.completed++,
        onCancelled: () => {},
        onError: () => {},
      },
    );

    await Promise.all([initial, replacement]);
    expect(first.completed).toBe(0);
    expect(first.cancelled).toBe(1);
    expect(second.completed).toBe(1);
    expect(second.text).toContain('second selection');
    expect(first.text).not.toContain('应结合原文理解。');
  });
});
