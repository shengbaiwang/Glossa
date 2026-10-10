import { ModelServiceError, normalizeBaseUrl, type ProviderConfig } from '@/glossa/ai/provider';
import { checkAborted } from '@/glossa/context/text';

type Priority = 'interactive' | 'background';
interface Ticket {
  priority: Priority;
  start: () => void;
}
interface Queue {
  active: number;
  blockedUntil: number;
  serialUntil: number;
  interactiveStreak: number;
  waiting: Ticket[];
  timer?: ReturnType<typeof setTimeout>;
}
const services = new Map<string, Queue>();
function drain(queue: Queue) {
  clearTimeout(queue.timer);
  if (!queue.waiting.length) return;
  const delay = queue.blockedUntil - Date.now();
  if (delay > 0) {
    queue.timer = setTimeout(() => drain(queue), Math.min(delay, 2147483647));
    return;
  }
  while (queue.waiting.length && queue.active < (queue.serialUntil > Date.now() ? 1 : 2)) {
    const interactive = queue.waiting.findIndex((ticket) => ticket.priority === 'interactive');
    const background = queue.waiting.findIndex((ticket) => ticket.priority === 'background');
    const index =
      interactive >= 0 && (background < 0 || queue.interactiveStreak < 3)
        ? interactive
        : background;
    const ticket = queue.waiting.splice(index, 1)[0]!;
    queue.interactiveStreak = ticket.priority === 'interactive' ? queue.interactiveStreak + 1 : 0;
    queue.active++;
    ticket.start();
  }
}

/** One endpoint allowance per window. Callers retain their own deadlines and call budgets. */
export async function scheduleRequest<T>(
  config: ProviderConfig,
  signal: AbortSignal,
  work: (queuedMs: number) => Promise<T>,
  priority: Priority = 'background',
): Promise<T> {
  checkAborted(signal);
  const key = normalizeBaseUrl(config.baseUrl);
  let queue = services.get(key);
  if (!queue) {
    for (const [oldKey, old] of services)
      if (!old.active && !old.waiting.length && old.serialUntil <= Date.now())
        services.delete(oldKey);
    queue = { active: 0, blockedUntil: 0, serialUntil: 0, interactiveStreak: 0, waiting: [] };
    services.set(key, queue);
  }
  const service = queue;
  const started = Date.now();
  await new Promise<void>((resolve, reject) => {
    const cancel = () => {
      const index = service.waiting.indexOf(ticket);
      if (index >= 0) service.waiting.splice(index, 1);
      signal.removeEventListener('abort', cancel);
      drain(service);
      reject(new DOMException('Cancelled', 'AbortError'));
    };
    const ticket: Ticket = {
      priority,
      start: () => {
        signal.removeEventListener('abort', cancel);
        resolve();
      },
    };
    service.waiting.push(ticket);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    else drain(service);
  });
  try {
    checkAborted(signal);
    return await new Promise<T>((resolve, reject) => {
      const cancel = () => reject(new DOMException('Cancelled', 'AbortError'));
      signal.addEventListener('abort', cancel, { once: true });
      Promise.resolve()
        .then(() => {
          checkAborted(signal);
          return work(Date.now() - started);
        })
        .then(resolve, reject)
        .finally(() => signal.removeEventListener('abort', cancel));
      if (signal.aborted) cancel();
    });
  } catch (error) {
    if (error instanceof ModelServiceError && error.code === 'rate_limit') {
      service.blockedUntil = Math.max(
        service.blockedUntil,
        Date.now() + (error.retryAfterMs ?? 1000),
      );
      service.serialUntil = Math.max(service.serialUntil, service.blockedUntil + 60000);
    }
    throw error;
  } finally {
    service.active--;
    drain(service);
    if (!service.active && !service.waiting.length && service.serialUntil <= Date.now())
      services.delete(key);
  }
}
