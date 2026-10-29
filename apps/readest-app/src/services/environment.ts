import { AppService } from '@/types/system';
import { READEST_NODE_BASE_URL, READEST_WEB_BASE_URL } from './constants';
import { getRuntimeConfig } from './runtimeConfig';

declare global {
  interface Window {
    __READEST_CLI_ACCESS?: boolean;
  }
}

export { getAppName, getAppScheme } from './appIdentity';

export const isTauriAppPlatform = () => process.env['NEXT_PUBLIC_APP_PLATFORM'] === 'tauri';
export const isWebAppPlatform = () => process.env['NEXT_PUBLIC_APP_PLATFORM'] === 'web';
export const hasCli = () => window.__READEST_CLI_ACCESS === true;
export const isPWA = () => window.matchMedia('(display-mode: standalone)').matches;
export const getBaseUrl = () =>
  getRuntimeConfig()?.apiBaseUrl ??
  process.env['API_BASE_URL'] ??
  process.env['NEXT_PUBLIC_API_BASE_URL'] ??
  READEST_WEB_BASE_URL;
export const getNodeBaseUrl = () =>
  process.env['NEXT_PUBLIC_NODE_BASE_URL'] ?? READEST_NODE_BASE_URL;

export const isMacPlatform = () =>
  typeof window !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

export const getCommandPaletteShortcut = () => (isMacPlatform() ? '⌘⇧P' : 'Ctrl+Shift+P');

const isWebDevMode = () => process.env['NODE_ENV'] === 'development' && isWebAppPlatform();

// Dev API only in development mode and web platform
// with command `pnpm dev-web`
// for production build or tauri app use the production Web API
export const getAPIBaseUrl = () => (isWebDevMode() ? '/api' : `${getBaseUrl()}/api`);

// For Node.js API that currently not supported in some edge runtimes
export const getNodeAPIBaseUrl = () => (isWebDevMode() ? '/api' : `${getNodeBaseUrl()}/api`);

export interface EnvConfigType {
  getAppService: () => Promise<AppService>;
}

let nativeAppService: AppService | null = null;
let nativeAppServiceInit: Promise<AppService> | null = null;
const getNativeAppService = async () => {
  if (nativeAppService) return nativeAppService;
  if (!nativeAppServiceInit) {
    nativeAppServiceInit = (async () => {
      const { NativeAppService } = await import('@/services/nativeAppService');
      const service = new NativeAppService();
      await service.init();
      nativeAppService = service;
      return service;
    })().catch((error) => {
      nativeAppServiceInit = null;
      throw error;
    });
  }
  return nativeAppServiceInit;
};

let webAppService: AppService | null = null;
let webAppServiceInit: Promise<AppService> | null = null;
const getWebAppService = async () => {
  if (webAppService) return webAppService;
  if (!webAppServiceInit) {
    webAppServiceInit = (async () => {
      const { WebAppService } = await import('@/services/webAppService');
      const service = new WebAppService();
      await service.init();
      webAppService = service;
      return service;
    })().catch((error) => {
      webAppServiceInit = null;
      throw error;
    });
  }
  return webAppServiceInit;
};

const environmentConfig: EnvConfigType = {
  getAppService: async () => {
    if (isTauriAppPlatform()) {
      return getNativeAppService();
    } else {
      return getWebAppService();
    }
  },
};

/**
 * Synchronously returns the app service after initialization has completed via
 * {@link environmentConfig.getAppService}; null before first init. The async
 * getter is preferred everywhere — use this only from synchronous code paths
 * that run well after startup (e.g. capability checks during reader render),
 * where the singleton is guaranteed to exist.
 */
export const getInitializedAppService = (): AppService | null => nativeAppService ?? webAppService;

export default environmentConfig;
