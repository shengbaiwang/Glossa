import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { writeTextToClipboard } from '@/utils/clipboard';
import type { ChapterSource } from '@/glossa/context/types';
import { renderAnswerHtml } from './answerMarkdown';
import type { BookDoc } from '@/libs/document';
import ConversationCitationPreview from './ConversationCitationPreview';

const COPY_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M6.5 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v.5"/></svg>';
const CHECK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
export default function ConversationAnswer({
  text,
  sources,
  onSource,
  bookDoc,
  sourceLabel,
}: {
  text: string;
  sources?: ChapterSource[];
  onSource?: (source: ChapterSource, cited: ChapterSource[]) => void;
  bookDoc?: BookDoc;
  sourceLabel?: string;
}) {
  const _ = useTranslation();
  const translate = useRef(_);
  translate.current = _;
  const root = useRef<HTMLDivElement>(null);
  const evidence = useRef({ sources, onSource });
  evidence.current = { sources, onSource };
  // Keep this object stable so React does not replace the enhanced code blocks
  // when the composer or conversation menu rerenders the parent.
  const sourceIdentity = JSON.stringify(sources ?? []);
  const markup = useMemo(() => ({ __html: renderAnswerHtml(text) }), [text, sourceIdentity]);
  const copyError = useRef<HTMLParagraphElement>(null);
  const [preview, setPreview] = useState<{
    anchor: HTMLElement;
    source: ChapterSource;
    number: number;
    markup: { __html: string };
  } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keepPreview = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  };
  const closePreview = () => {
    keepPreview();
    setPreview(null);
  };
  const leavePreview = () => {
    keepPreview();
    hoverTimer.current = setTimeout(() => setPreview(null), 180);
  };
  useLayoutEffect(() => {
    const container = root.current;
    if (!container) return;
    closePreview();
    const timers = new Set<number>();
    const cited: ChapterSource[] = [];
    const citations = new Map<HTMLElement, { source: ChapterSource; number: number }>();
    container.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
      const href = anchor.getAttribute('href') ?? '';
      if (href.startsWith('#source-')) {
        const id = href.slice('#source-'.length);
        const source = evidence.current.sources?.find((source) => source.sourceId === id);
        if (!source) {
          anchor.removeAttribute('href');
        } else {
          let index = cited.findIndex((item) => item.sourceId === id);
          if (index < 0) index = cited.push(source) - 1;
          const label = anchor.textContent?.trim() ?? '';
          // Preserve substantive linked prose from older/model-authored answers.
          if (!/^(?:\[?\d+\]?|原文|来源|來源|source|citation)$/i.test(label))
            anchor.before(document.createTextNode(`${label} `));
          anchor.textContent = String(index + 1);
          anchor.setAttribute('class', 'glossa-chat-source-link');
          anchor.setAttribute(
            'aria-label',
            `${translate.current('Open source passage')} ${index + 1}`,
          );
          anchor.removeAttribute('title');
          citations.set(anchor, { source, number: index + 1 });
        }
        return;
      }
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noopener noreferrer');
    });
    for (const pre of Array.from(container.querySelectorAll('pre'))) {
      if (pre.parentElement?.classList.contains('glossa-chat-code')) continue;
      const wrap = document.createElement('div');
      wrap.className = 'glossa-chat-code';
      pre.replaceWith(wrap);
      wrap.append(pre);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'glossa-chat-code-copy';
      button.setAttribute('aria-label', translate.current('Copy code'));
      button.setAttribute('title', translate.current('Copy code'));
      button.innerHTML = COPY_ICON;
      wrap.append(button);
    }
    const onClick = (event: Event) => {
      const anchor = (event.target as Element | null)?.closest('a');
      const href = anchor?.getAttribute('href');
      if (href?.startsWith('#source-')) {
        event.preventDefault();
        const source = evidence.current.sources?.find(
          (item) => item.sourceId === href.slice('#source-'.length),
        );
        closePreview();
        if (source) evidence.current.onSource?.(source, cited);
        return;
      }
      const button = (event.target as Element | null)?.closest('.glossa-chat-code-copy');
      if (!(button instanceof HTMLElement)) return;
      const code = button.parentElement?.querySelector('pre')?.textContent ?? '';
      if (copyError.current) copyError.current.hidden = true;
      void writeTextToClipboard(code)
        .then(() => {
          button.classList.add('is-copied');
          button.setAttribute('aria-label', translate.current('Copied'));
          button.innerHTML = CHECK_ICON;
          const timer = window.setTimeout(() => {
            timers.delete(timer);
            button.classList.remove('is-copied');
            button.setAttribute('aria-label', translate.current('Copy code'));
            button.innerHTML = COPY_ICON;
          }, 1600);
          timers.add(timer);
        })
        .catch(() => {
          if (copyError.current) copyError.current.hidden = false;
        });
    };
    const citationAt = (target: EventTarget | null) => {
      const anchor = target instanceof Element ? target.closest('a') : null;
      const citation = anchor && citations.get(anchor);
      return anchor && citation ? { anchor, ...citation } : null;
    };
    const onHover = (event: MouseEvent) => {
      const next = citationAt(event.target);
      if (!next || next.anchor.contains(event.relatedTarget as Node | null)) return;
      keepPreview();
      hoverTimer.current = setTimeout(() => setPreview({ ...next, markup }), 220);
    };
    const onLeave = (event: MouseEvent) => {
      const current = citationAt(event.target);
      if (current && !current.anchor.contains(event.relatedTarget as Node | null)) leavePreview();
    };
    const onFocus = (event: FocusEvent) => {
      const next = citationAt(event.target);
      if (next) {
        keepPreview();
        setPreview({ ...next, markup });
      }
    };
    container.addEventListener('click', onClick);
    container.addEventListener('mouseover', onHover);
    container.addEventListener('mouseout', onLeave);
    container.addEventListener('focusin', onFocus);
    container.addEventListener('focusout', closePreview);
    return () => {
      keepPreview();
      container.removeEventListener('click', onClick);
      container.removeEventListener('mouseover', onHover);
      container.removeEventListener('mouseout', onLeave);
      container.removeEventListener('focusin', onFocus);
      container.removeEventListener('focusout', closePreview);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [markup]);
  return (
    <>
      <div
        key={sourceIdentity}
        className='glossa-chat-answer'
        dir='auto'
        ref={root}
        dangerouslySetInnerHTML={markup}
      />
      {preview && preview.markup === markup && bookDoc && (
        <ConversationCitationPreview
          key={`${sourceIdentity}:${preview.source.sourceId}`}
          {...preview}
          label={sourceLabel}
          bookDoc={bookDoc}
          onEnter={keepPreview}
          onLeave={leavePreview}
          onClose={closePreview}
        />
      )}
      <p ref={copyError} hidden className='glossa-chat-message' role='alert'>
        {_('The code could not be copied.')}
      </p>
    </>
  );
}
