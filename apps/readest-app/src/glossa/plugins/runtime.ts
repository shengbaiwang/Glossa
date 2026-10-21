import { useSettingsStore } from '@/store/settingsStore';
import { isPluginEnabled, type PluginId } from './registry';

/** One explicit activation owns one abort signal and one settings subscription.
 * Disable is irreversible for this activation, even if enabled again immediately.
 * Tasks must honor the signal before publishing results; persistence cleanup can finish.
 */
export async function runPluginTask(
  id: PluginId,
  task: (signal: AbortSignal) => Promise<void>,
): Promise<void> {
  if (!isPluginEnabled(useSettingsStore.getState().settings, id)) return;
  const controller = new AbortController();
  const unsubscribe = useSettingsStore.subscribe(({ settings }) => {
    if (!isPluginEnabled(settings, id)) controller.abort();
  });
  try {
    await task(controller.signal);
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    unsubscribe();
    controller.abort();
  }
}
