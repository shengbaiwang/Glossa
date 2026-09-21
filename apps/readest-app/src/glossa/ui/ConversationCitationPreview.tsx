import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { BookDoc } from '@/libs/document';
import type { ChapterSource } from '@/glossa/context/types';
import { resolveSource } from '@/glossa/citations/sources';
import { useTranslation } from '@/hooks/useTranslation';

/** Read only the cited local anchor. Previewing never changes the reader location. */
export default function ConversationCitationPreview({
  anchor,
  source,
  number,
  label,
  bookDoc,
  onEnter,
  onLeave,
  onClose,
}: {
  anchor: HTMLElement;
  source: ChapterSource;
  number: number;
  label?: string;
  bookDoc: BookDoc;
  onEnter: () => void;
  onLeave: () => void;
  onClose: () => void;
}) {
  const _ = useTranslation();
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [passage, setPassage] = useState({ text: source.text, status: 'loading' });
  const [position, setPosition] = useState({ left: 0, top: 0 });

  useEffect(() => {
    const controller = new AbortController();
    setPassage({ text: source.text, status: 'loading' });
    void resolveSource(bookDoc, source, { signal: controller.signal })
      .then((resolved) => {
        if (!controller.signal.aborted)
          setPassage({
            text: resolved?.text ?? source.text,
            status: resolved ? 'verified' : 'unverified',
          });
      })
      .catch(() => {
        if (!controller.signal.aborted) setPassage({ text: source.text, status: 'unverified' });
      });
    anchor.setAttribute('aria-describedby', id);
    const dismiss = () => close.current();
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        dismiss();
      }
    };
    const scroll = (event: Event) => {
      if (event.target instanceof Node && root.current?.contains(event.target)) return;
      dismiss();
    };
    document.addEventListener('keydown', onEscape, true);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', dismiss);
    return () => {
      controller.abort();
      anchor.removeAttribute('aria-describedby');
      document.removeEventListener('keydown', onEscape, true);
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [anchor, source, bookDoc, id]);

  useLayoutEffect(() => {
    if (!root.current) return;
    const target = anchor.getBoundingClientRect();
    const bounds = root.current.getBoundingClientRect();
    const below = target.bottom + 8;
    setPosition({
      left: Math.max(12, Math.min(target.left, window.innerWidth - bounds.width - 12)),
      top: Math.max(
        12,
        below + bounds.height <= window.innerHeight - 12 ? below : target.top - bounds.height - 8,
      ),
    });
  }, [anchor, passage]);

  return createPortal(
    <div
      ref={root}
      id={id}
      role='tooltip'
      className='glossa-chat-citation-preview eink-bordered'
      style={position}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <header>
        <span className='glossa-chat-citation-number'>{number}</span>
        <strong dir='auto'>{label || _('Original passage')}</strong>
      </header>
      <blockquote dir='auto'>{passage.text}</blockquote>
      {passage.status !== 'verified' && (
        <p role='status'>
          {_(passage.status === 'loading' ? 'Locating source…' : 'Saved excerpt · unverified')}
        </p>
      )}
    </div>,
    document.body,
  );
}
