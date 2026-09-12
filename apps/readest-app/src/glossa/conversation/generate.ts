import {
  streamCompletion,
  type CompletionMessage,
  type ProviderConfig,
} from '@/glossa/ai/provider';
import { checkAborted } from '@/glossa/context/text';
import { stubTranslation as _ } from '@/utils/misc';
import {
  ConversationError,
  CONVERSATION_PROMPT_VERSION,
  chatIdentitySchema,
  currentAnswerVersion,
  MAX_QUESTION_CHARS,
  type ChatIdentity,
  type ConversationTurn,
} from './schema';

interface Request {
  metadata: ChatIdentity;
  question: string;
  turns: ConversationTurn[];
  config: ProviderConfig;
  /** User-defined prompt from Settings; no system message is sent without it. */
  prompt?: string;
  signal: AbortSignal;
  onText?: (text: string) => void;
}

/** Keep complete recent exchanges, across model changes, without replaying legacy book material. */
export function conversationMessages(turns: ConversationTurn[]): CompletionMessage[] {
  const messages: CompletionMessage[] = [];
  let size = 0;
  for (const turn of turns.slice().reverse()) {
    if (turn.promptVersion !== CONVERSATION_PROMPT_VERSION) continue;
    const selected = currentAnswerVersion(turn);
    if (selected.status !== 'complete') continue;
    const answer = selected.text;
    size += selected.question.length + answer.length;
    if (size > 48000 || messages.length >= 24) break;
    messages.unshift(
      { role: 'user', content: selected.question },
      { role: 'assistant', content: answer },
    );
  }
  return messages;
}

export async function generateConversation(
  input: Request,
  { complete = streamCompletion } = {},
): Promise<string> {
  checkAborted(input.signal);
  const question = input.question.trim();
  if (!question || question.length > MAX_QUESTION_CHARS)
    throw new ConversationError(_('Use a shorter question.'));
  // Pick fields explicitly: even an older caller cannot send a passage or reading position.
  const metadata = chatIdentitySchema.parse({
    bookTitle: input.metadata.bookTitle,
    author: input.metadata.author,
    chapterTitle: input.metadata.chapterTitle,
  });
  const prompt = input.prompt?.trim() ?? '';
  if (prompt.length > 8000) throw new ConversationError(_('Use a shorter prompt.'));
  let received = '';
  const raw = await complete({
    config: input.config,
    signal: input.signal,
    maxTokens: input.config.maxTokens ?? 16384,
    messages: [
      ...(prompt ? [{ role: 'system' as const, content: prompt }] : []),
      { role: 'user', content: JSON.stringify(metadata) },
      ...conversationMessages(input.turns),
      { role: 'user', content: question },
    ],
    onDelta: (delta) => {
      checkAborted(input.signal);
      received += delta;
      if (received.length > 32000)
        throw new ConversationError(_('The reply is too long. Ask a more focused question.'));
      input.onText?.(received);
    },
  });
  checkAborted(input.signal);
  if (!raw.trim() || raw.length > 32000)
    throw new ConversationError(_('The reply could not be completed. Try again.'));
  return raw;
}

interface TitleRequest {
  question: string;
  answer: string;
  config: ProviderConfig;
  signal?: AbortSignal;
}

/**
 * A short session name from the first exchange, in the question's language.
 * Returns '' when nothing usable comes back; callers keep the question label.
 */
export async function generateConversationTitle(
  input: TitleRequest,
  { complete = streamCompletion } = {},
): Promise<string> {
  const raw = await complete({
    // A title never needs deliberate reasoning; let the service default apply.
    config: { ...input.config, reasoningEffort: undefined },
    signal: input.signal,
    maxTokens: 256,
    messages: [
      {
        role: 'user',
        content: [
          'Name this conversation in at most 12 words, in the same language as the question. Reply with the name only, without quotes or trailing punctuation.',
          `Question: ${input.question.slice(0, 1000)}`,
          `Answer: ${input.answer.slice(0, 2000)}`,
        ].join('\n\n'),
      },
    ],
  });
  return (raw.split('\n')[0] ?? '')
    .replace(/^[\s"'“”‘’「『#*<>-]+|[\s"'“”‘’」』#*<>.,，。!！?？:：;；、-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48)
    .trim();
}
