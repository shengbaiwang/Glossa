/** Google Drive's slot in the shared keychain token store. */
import {
  createKeychainTokenPersistence,
  type TokenPersistence,
} from '@/services/sync/providers/oauth/keychainTokenStore';

export type { TokenPersistence };
export const DRIVE_TOKEN_KEY = 'glossa_gdrive_token_set';

export const createDriveTokenPersistence = (clientId?: string): Promise<TokenPersistence | null> =>
  createKeychainTokenPersistence(
    `${DRIVE_TOKEN_KEY}:${clientId ?? 'unconfigured'}`,
    'Google Drive',
  );
