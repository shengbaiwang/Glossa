import DOMPurify from 'dompurify';

/** Dictionaries retain layout and internal entry/audio links, never executable markup. */
export function sanitizeDictionaryHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_TAGS: ['link'],
    ADD_URI_SAFE_ATTR: ['rel'],
    FORCE_BODY: true,
    ALLOWED_URI_REGEXP:
      /^(?:(?:https?|mailto|tel|blob|entry|sound|bword):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
  });
}
