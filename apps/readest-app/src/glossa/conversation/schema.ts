import { z } from 'zod';
import { contextReceiptSchema } from './context';
import type { ChapterSource } from '@/glossa/context/types';
import { passageSourcesSchema } from '@/glossa/guide/schema';
import { stubTranslation as _ } from '@/utils/misc';

export class ConversationError extends Error {}
export const CONVERSATION_PROMPT_VERSION = 'conversation-3';
export const chatIdentitySchema = z
  .object({
    bookTitle: z.string().max(500),
    author: z.string().max(500),
    chapterTitle: z.string().max(500),
  })
  .strict();
export type ChatIdentity = z.infer<typeof chatIdentitySchema>;
export const conversationSourcesSchema = passageSourcesSchema.or(z.array(z.never()).length(0));
export const blockSchema = z
  .object({
    kind: z.enum(['source', 'inference', 'background', 'insufficient']),
    text: z.string().trim().min(1).max(1400),
    sourceIds: z.array(z.string().min(1).max(200)).max(4),
  })
  .strict()
  .refine(
    (block) =>
      new Set(block.sourceIds).size === block.sourceIds.length &&
      (!['source', 'inference'].includes(block.kind) || block.sourceIds.length > 0),
  );
export type ConversationBlock = z.infer<typeof blockSchema>;
export const bodySchema = z.object({ blocks: z.array(blockSchema).min(1).max(8) }).strict();
const legacyTurnSchema = bodySchema
  .extend({
    id: z.string().min(1).max(100),
    question: z.string().trim().min(1).max(2000),
    sources: conversationSourcesSchema,
    createdAt: z.number().finite(),
    provider: z
      .object({ id: z.string(), name: z.string(), baseUrl: z.string(), model: z.string() })
      .strict(),
    promptVersion: z.enum(['conversation-1', 'conversation-2']),
    context: contextReceiptSchema.optional(),
  })
  .strict();
const chatTurnSchema = z
  .object({
    id: z.string().min(1).max(100),
    question: z.string().trim().min(1).max(2000),
    blocks: z
      .array(
        z
          .object({
            kind: z.literal('background'),
            text: z.string().min(1).max(32000),
            sourceIds: z.array(z.never()).length(0),
          })
          .strict(),
      )
      .length(1),
    sources: z.array(z.never()).length(0),
    createdAt: z.number().finite(),
    provider: z
      .object({ id: z.string(), name: z.string(), baseUrl: z.string(), model: z.string() })
      .strict(),
    promptVersion: z.literal(CONVERSATION_PROMPT_VERSION),
    metadata: chatIdentitySchema,
    status: z.enum(['complete', 'stopped', 'failed']),
    context: z.undefined().optional(),
  })
  .strict();
export const turnSchema = z.union([legacyTurnSchema, chatTurnSchema]);
export type ConversationTurn = z.infer<typeof turnSchema>;

export const validBlockSources = (blocks: ConversationBlock[], sources: ChapterSource[]) => {
  const ids = new Set(sources.map((s) => s.sourceId));
  return blocks.every((b) => b.sourceIds.every((id) => ids.has(id)));
};

export function parseConversation(raw: string, sources: ChapterSource[]): ConversationBlock[] {
  try {
    if (raw.length > 24000) throw new Error();
    const json = raw.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1');
    const { blocks } = bodySchema.parse(JSON.parse(json));
    if (!validBlockSources(blocks, sources)) throw new Error();
    return blocks;
  } catch {
    throw new ConversationError(
      _('The reply was incomplete or cited unavailable sources. Try again.'),
    );
  }
}

/** Publish only complete paragraphs whose structure and source whitelist already validate. */
export function readStreamingBlocks(raw: string, sources: ChapterSource[]): ConversationBlock[] {
  if (raw.length > 24000) return [];
  const start = /^\s*(?:```(?:json)?\s*)?\{\s*"blocks"\s*:\s*\[/.exec(raw);
  if (!start) return [];
  const blocks: ConversationBlock[] = [];
  let depth = 0,
    quoted = false,
    escaped = false,
    from = -1;
  for (let i = start[0].length; i < raw.length; i++) {
    const char = raw[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{') {
      if (depth++ === 0) from = i;
    } else if (char === '}' && --depth === 0 && from >= 0) {
      try {
        const block = blockSchema.parse(JSON.parse(raw.slice(from, i + 1)));
        if (!validBlockSources([block], sources) || blocks.length === 8) break;
        blocks.push(block);
      } catch {
        break;
      }
    } else if (char === ']' && depth === 0) break;
  }
  return blocks;
}
