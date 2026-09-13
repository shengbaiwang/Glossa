import { getInitializedAppService } from '@/services/environment';
import type { TTSClient } from './TTSClient';
export async function createReadingSpeechClient(): Promise<TTSClient> {
  const app = getInitializedAppService();
  if (app?.isAndroidApp || app?.isIOSApp) {
    const { NativeTTSClient } = await import('./NativeTTSClient');
    return new NativeTTSClient();
  }
  const { WebSpeechClient } = await import('./WebSpeechClient');
  return new WebSpeechClient();
}
