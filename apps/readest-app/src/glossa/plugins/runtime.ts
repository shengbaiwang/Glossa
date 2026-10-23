import { useSettingsStore } from '@/store/settingsStore';
import { isPluginEnabled, type PluginId } from './registry';

/** One explicit activation owns one abort signal and one settings subscription.
 * Disable is irreversible for this activation, even if enabled again immediately.
 * Tasks must honor the signal before publishing results; persistence cleanup can finish.
 */
export async function runPluginTask(
  id: PluginId,
  task: (signal: AbortSignal) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted || !isPluginEnabled(useSettingsStore.getState().settings, id)) return;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const unsubscribe = useSettingsStore.subscribe(({ settings }) => {
    if (!isPluginEnabled(settings, id)) controller.abort();
  });
  try {
    await task(controller.signal);
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
    unsubscribe();
    controller.abort();
  }
}
