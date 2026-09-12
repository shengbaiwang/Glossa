import { z } from 'zod';
import { contextReceiptSchema } from './context';
import type { ChapterSource } from '@/glossa/context/types';
import { passageSourcesSchema } from '@/glossa/guide/schema';
import { stubTranslation as _ } from '@/utils/misc';

export class ConversationError extends Error {}
export const CONVERSATION_PROMPT_VERSION = 'conversation-3';
export const MAX_QUESTION_CHARS = 20000;
export const MAX_TURN_VERSIONS = 8;
export const chatIdentitySchema = z
  .object({
    bookTitle: z.string().max(500),
    author: z.string().max(500),
    chapterTitle: z.string().max(500),
  })
  .strict();
export type ChatIdentity = z.infer<typeof chatIdentitySchema>;
export const conversationSourcesSchema = passageSourcesSchema.or(z.array(z.never()).length(0));
export const providerSchema = z
  .object({ id: z.string(), name: z.string(), baseUrl: z.string(), model: z.string() })
  .strict();
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

/** One answer to one question. Regenerating or editing a question adds a version instead of overwriting. */
export const answerVersionSchema = z
  .object({
    id: z.string().min(1).max(100),
    question: z.string().trim().min(1).max(MAX_QUESTION_CHARS),
    text: z.string().min(1).max(32000),
    createdAt: z.number().finite(),
    provider: providerSchema,
    status: z.enum(['complete', 'stopped', 'failed']),
  })
  .strict();
export type AnswerVersion = z.infer<typeof answerVersionSchema>;

const legacyTurnSchema = bodySchema
  .extend({
    id: z.string().min(1).max(100),
    question: z.string().trim().min(1).max(MAX_QUESTION_CHARS),
    sources: conversationSourcesSchema,
    createdAt: z.number().finite(),
    provider: providerSchema,
    promptVersion: z.enum(['conversation-1', 'conversation-2']),
    context: contextReceiptSchema.optional(),
  })
  .strict();
const chatTurnSchema = z
  .object({
    id: z.string().min(1).max(100),
    question: z.string().trim().min(1).max(MAX_QUESTION_CHARS),
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
    provider: providerSchema,
    promptVersion: z.literal(CONVERSATION_PROMPT_VERSION),
    metadata: chatIdentitySchema,
    status: z.enum(['complete', 'stopped', 'failed']),
    versions: z.array(answerVersionSchema).min(1).max(MAX_TURN_VERSIONS).optional(),
    activeVersionId: z.string().min(1).max(100).optional(),
    context: z.undefined().optional(),
  })
  .strict()
  .refine(
    (turn) =>
      (turn.versions === undefined) === (turn.activeVersionId === undefined) &&
      (!turn.versions ||
        (new Set(turn.versions.map((version) => version.id)).size === turn.versions.length &&
          turn.versions.some((version) => version.id === turn.activeVersionId))),
    { message: 'The answer versions are inconsistent.' },
  );
export const turnSchema = z.union([legacyTurnSchema, chatTurnSchema]);
export type ConversationTurn = z.infer<typeof turnSchema>;

/** The version currently selected for a turn, or a synthetic one built from its stored answer. */
export function currentAnswerVersion(turn: ConversationTurn): AnswerVersion {
  if ('versions' in turn && turn.versions) {
    return (
      turn.versions.find((version) => version.id === turn.activeVersionId) ??
      turn.versions[turn.versions.length - 1]!
    );
  }
  return {
    id: turn.id,
    question: turn.question,
    text: turn.blocks.map((block) => block.text).join('\n\n'),
    createdAt: turn.createdAt,
    provider: turn.provider,
    status: turn.promptVersion === CONVERSATION_PROMPT_VERSION ? turn.status : 'complete',
  };
}

/** Mirror the chosen version into the legacy top-level fields so history sends only that answer. */
export function selectAnswerVersion(turn: ConversationTurn, versionId: string): ConversationTurn {
  if (!('versions' in turn) || !turn.versions) return turn;
  const version = turn.versions.find((item) => item.id === versionId);
  if (!version) return turn;
  return {
    ...turn,
    activeVersionId: version.id,
    question: version.question,
    blocks: [{ kind: 'background', text: version.text, sourceIds: [] }],
    createdAt: version.createdAt,
    provider: version.provider,
    status: version.status,
  };
}

/** Bring a legacy (conversation-1/2) turn forward without losing its original answer. */
export function chatTurnFrom(turn: ConversationTurn, metadata: ChatIdentity): ConversationTurn {
  if (turn.promptVersion === CONVERSATION_PROMPT_VERSION) return turn;
  const version = currentAnswerVersion(turn);
  return {
    id: turn.id,
    question: version.question,
    blocks: [{ kind: 'background', text: version.text, sourceIds: [] }],
    sources: [],
    createdAt: version.createdAt,
    provider: version.provider,
    promptVersion: CONVERSATION_PROMPT_VERSION,
    metadata,
    status: 'complete',
  };
}

/** Add an answer version, retaining prior answers, and make it the active one. */
export function addAnswerVersion(turn: ConversationTurn, version: AnswerVersion): ConversationTurn {
  const existing =
    'versions' in turn && turn.versions ? turn.versions : [currentAnswerVersion(turn)];
  const next = {
    ...turn,
    versions: [...existing, version],
    activeVersionId: version.id,
  } as ConversationTurn;
  return selectAnswerVersion(next, version.id);
}

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
