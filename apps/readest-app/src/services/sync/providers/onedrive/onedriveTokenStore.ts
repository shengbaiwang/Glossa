/** OneDrive's slot in the shared keychain token store. */
import {
  createKeychainTokenPersistence,
  type TokenPersistence,
} from '@/services/sync/providers/oauth/keychainTokenStore';

export type { TokenPersistence };
export const ONEDRIVE_TOKEN_KEY = 'glossa_onedrive_token_set';

export const createOneDriveTokenPersistence = (
  clientId?: string,
): Promise<TokenPersistence | null> =>
  createKeychainTokenPersistence(`${ONEDRIVE_TOKEN_KEY}:${clientId ?? 'unconfigured'}`, 'OneDrive');
