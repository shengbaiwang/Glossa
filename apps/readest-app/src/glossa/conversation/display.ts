export const CONVERSATION_FONT_SIZES = [
  { id: 'small', label: 'Small', px: 12 },
  { id: 'medium', label: 'Medium', px: 14 },
  { id: 'large', label: 'Large', px: 16 },
  { id: 'x-large', label: 'Extra large', px: 18 },
] as const;
export type ConversationFontSize = (typeof CONVERSATION_FONT_SIZES)[number]['id'];

const STORAGE_KEY = 'glossa.conversation-font.v1';
const DEFAULT_FONT_SIZE: ConversationFontSize = 'medium';

export function getConversationFontSize(): ConversationFontSize {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return CONVERSATION_FONT_SIZES.some((size) => size.id === stored)
      ? (stored as ConversationFontSize)
      : DEFAULT_FONT_SIZE;
  } catch {
    return DEFAULT_FONT_SIZE;
  }
}

export function setConversationFontSize(id: ConversationFontSize): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // A blocked preference must not interrupt reading; the session keeps its choice.
  }
}

export function conversationFontPx(id: ConversationFontSize): number {
  return CONVERSATION_FONT_SIZES.find((size) => size.id === id)?.px ?? 14;
}
