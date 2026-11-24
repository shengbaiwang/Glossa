import type { FileSyncProvider } from '@/services/sync/file/provider';

const directory = '/GlossaSync-v2';
export const isVaultId = (id: unknown): id is string =>
  typeof id === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id);
export const vaultRoot = (id: string) => {
  if (!isVaultId(id)) throw new Error('Invalid iCloud library identity');
  return directory + '/' + id;
};

// Independent UUID directories make concurrent initialization detectable even
// on two temporarily offline devices. Never overwrite another device's marker.
export async function selectVault(provider: FileSyncProvider, create: boolean) {
  const entries = (await provider.head(directory)) ? await provider.list(directory) : [];
  const vaults = entries.filter((e) => e.isDirectory && isVaultId(e.name));
  if (vaults.length > 1) throw new Error('Multiple iCloud libraries in this folder');
  if (vaults.length === 1) return vaults[0]!.name;
  if (!create) throw new Error('iCloud library is not available yet');
  const id = crypto.randomUUID();
  await provider.ensureDir([directory, vaultRoot(id)]);
  return id;
}
export async function verifyVault(provider: FileSyncProvider, id: string) {
  if ((await selectVault(provider, false)) !== id) throw new Error('iCloud library changed');
}
