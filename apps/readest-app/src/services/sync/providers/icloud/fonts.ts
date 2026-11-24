import { z } from 'zod';
import type { AppService } from '@/types/system';
import type { CustomFont } from '@/styles/fonts';
import { fingerprintFile } from '@/services/bookIdentity';
import type { FileSyncProvider } from '../../file/provider';
import { ancestorsOf } from '../../file/layout';
import { assetReference, openVaultBlob, publishBlob } from './blob';
import { digest } from './noteJournal';
const entry = z
  .object({
    schema_version: z.literal(2),
    asset: assetReference,
    name: z.string().min(1).max(256),
    filename: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[^/\\\x00-\x1f]+\.(ttf|otf|woff2?)$/i),
  })
  .strict();
export type CloudFont = z.infer<typeof entry>;
export type FontSelection = { id: string; hash: string; name: string; filename: string };
export async function selectFont(app: AppService, font: CustomFont): Promise<FontSelection> {
  const file = await app.openFile(font.path, 'Fonts');
  try {
    return {
      id: font.id,
      hash: await fingerprintFile(file),
      name: font.name,
      filename: font.path.split('/').pop()!,
    };
  } finally {
    await (file as File & { close?: () => Promise<void> }).close?.();
  }
}
export async function pushSelectedFonts(
  app: AppService,
  p: FileSyncProvider,
  fonts: CustomFont[],
  selected: FontSelection[],
  check: () => void,
) {
  const dir = p.rootPath + '/fonts';
  for (const selection of selected) {
    check();
    const font = fonts.find((f) => f.id === selection.id && !f.deletedAt && !f.unavailable);
    if (!font) continue;
    // The key includes the confirmed content identity and never includes a device path.
    const key = digest(JSON.stringify([selection.hash, selection.name, selection.filename]));
    const path = dir + '/' + key + '.json';
    const existing = await p.readText(path);
    if (existing !== null) {
      const row = entry.parse(JSON.parse(existing));
      if (
        'sha256:' + row.asset.file !== selection.hash ||
        row.asset.vault !== p.vaultId ||
        row.name !== selection.name ||
        row.filename !== selection.filename
      )
        throw new Error('Conflicting iCloud font');
      continue;
    }
    const file = await app.openFile(font.path, 'Fonts');
    try {
      const asset = await publishBlob(p, file, selection.hash, check);
      const row = entry.parse({
        schema_version: 2,
        asset,
        name: selection.name,
        filename: selection.filename,
      });
      await p.ensureDir(ancestorsOf(path));
      check();
      await p.writeText(path, JSON.stringify(row));
    } finally {
      await (file as File & { close?: () => Promise<void> }).close?.();
    }
  }
}
export async function listFonts(p: FileSyncProvider, check: () => void) {
  const dir = p.rootPath + '/fonts',
    rows: CloudFont[] = [];
  if (!(await p.head(dir))) return rows;
  for (const item of await p.list(dir)) {
    if (!/^[0-9a-f]{64}\.json$/.test(item.name) || item.isDirectory) continue;
    check();
    const raw = await p.readText(dir + '/' + item.name);
    if (!raw) continue;
    const row = entry.parse(JSON.parse(raw));
    if (
      row.asset.vault !== p.vaultId ||
      item.name !==
        digest(JSON.stringify(['sha256:' + row.asset.file, row.name, row.filename])) + '.json'
    )
      throw new Error('Invalid iCloud font');
    rows.push(row);
  }
  return rows;
}
export async function readFont(p: FileSyncProvider, row: CloudFont, check: () => void) {
  const file = await openVaultBlob(p, row.asset, row.filename, 'application/octet-stream', check);
  try {
    const bytes = await file.arrayBuffer();
    const local = new File([bytes], row.filename);
    if ((await fingerprintFile(local)) !== 'sha256:' + row.asset.file)
      throw new Error('Invalid iCloud font');
    check();
    return local;
  } finally {
    await file.close();
  }
}
