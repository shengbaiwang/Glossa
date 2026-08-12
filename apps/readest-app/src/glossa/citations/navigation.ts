import type { SourceAnchor } from './sourceAnchor';

/** JSON-safe outcome shared by every future document-format navigator. */
export type AnchorResolutionMethod = 'cfi' | 'text-quote' | 'section';

export type AnchorNavigationFailureReason =
  | 'invalid-anchor'
  | 'document-mismatch'
  | 'reader-unavailable'
  | 'section-unavailable'
  | 'quote-not-found'
  | 'ambiguous-quote'
  | 'navigation-failed'
  | 'aborted'
  | 'timeout';

export type AnchorNavigationResult =
  | {
      status: 'resolved';
      method: AnchorResolutionMethod;
      exact: boolean;
      anchor: SourceAnchor;
      canReturn: boolean;
    }
  | {
      status: 'not-found';
      reason: AnchorNavigationFailureReason;
    };

/**
 * In-memory lifecycle for one jump. The result is JSON-safe; the methods are
 * runtime controls and deliberately expose no DOM, foliate, or Readest state.
 */
export interface AnchorNavigationSession {
  readonly result: AnchorNavigationResult;
  returnToOrigin(): Promise<boolean>;
  dispose(): void;
}

export interface DocumentNavigator {
  navigate(anchor: unknown, options?: { signal?: AbortSignal }): Promise<AnchorNavigationSession>;
  dispose(): void;
}
