import { getRuntimeConfig } from '@/services/runtimeConfig';
const configuredOrigin = () =>
  getRuntimeConfig()?.glossaSyncOrigin ?? process.env['NEXT_PUBLIC_GLOSSA_SYNC_ORIGIN'];
export const hasGlossaSyncConfig = () => Boolean(configuredOrigin());
export function syncOrigin() {
  const raw = configuredOrigin();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    url.pathname !== '/' ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
  ) {
    return null;
  }
  return url.origin;
}
