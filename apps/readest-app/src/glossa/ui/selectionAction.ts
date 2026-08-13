import type { DocumentNavigator } from '../citations/navigation';
import {
  createChapterToSelectionContextPack,
  createContextPack,
  type ContextPack,
} from '../context/contextPack';
import type { SelectedText, SelectionChapterContext } from '../context/types';
import { isGlossaEnabled } from '../featureFlag';

export type SelectionCapture = () => Promise<SelectedText | null>;

export type GlossaPanelOpen = (
  selection: SelectedText,
  contextPack?: ContextPack,
  navigator?: DocumentNavigator,
  chapterContext?: { pack: ContextPack | null; unavailableReason?: string },
) => void;

/** Keep the Readest toolbar configuration untouched; this is a separate opt-in entry. */
export const canAskGlossaForEpubSelection = (
  format: string | undefined,
  selectionText: string | undefined,
): boolean => isGlossaEnabled() && format === 'EPUB' && !!selectionText?.trim();

/**
 * Capture the adapter's JSON-safe snapshot before the caller clears the live
 * browser Selection. Empty or unavailable selections are intentionally no-op.
 */
export const captureAndOpenGlossaPanel = async (
  capture: SelectionCapture,
  open: GlossaPanelOpen,
  options?: {
    captureContext?: (selection: SelectedText) => Promise<{
      minimal: ContextPack;
      chapter: { pack: ContextPack | null; unavailableReason?: string };
    }>;
    navigator?: DocumentNavigator;
  },
): Promise<boolean> => {
  const selection = await capture();
  if (!selection?.text.trim()) return false;

  // Adapter output is JSON-safe by contract. Cloning makes the panel's
  // transient snapshot independent from a later reader/adapter update.
  const snapshot = JSON.parse(JSON.stringify(selection)) as SelectedText;
  const context = options?.captureContext ? await options.captureContext(snapshot) : undefined;
  if (context || options?.navigator)
    open(snapshot, context?.minimal, options?.navigator, context?.chapter);
  else open(snapshot);
  return true;
};

/** Capture the selection-neighbourhood before Annotator clears the live Range. */
export const captureMinimalContextPack = async (
  selection: SelectedText,
  getSelectionContext: () => Promise<SelectedText[]>,
): Promise<ContextPack> =>
  createContextPack({ selection, selectionContext: await getSelectionContext() });

/** Snapshot both allowed scopes while the native Selection still exists. */
export const captureContextPacks = async (
  selection: SelectedText,
  getSelectionContext: () => Promise<SelectedText[]>,
  getChapterContext: () => Promise<SelectionChapterContext | null>,
): Promise<{
  minimal: ContextPack;
  chapter: { pack: ContextPack | null; unavailableReason?: string };
}> => {
  const minimal = await captureMinimalContextPack(selection, getSelectionContext);
  const chapterContext = await getChapterContext();
  if (!chapterContext) {
    return {
      minimal,
      chapter: { pack: null, unavailableReason: '无法安全确定选区前的章节范围。' },
    };
  }
  return {
    minimal,
    chapter: {
      pack: createChapterToSelectionContextPack({
        selection,
        precedingBlocks: chapterContext.section.blocks,
      }),
    },
  };
};
