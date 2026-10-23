import { z } from 'zod';
import { valid } from 'semver';

/** Draft v1 package metadata. Parsing a manifest never registers or executes code. */
export const PLUGIN_API_VERSION = 1;
const activationSchema = z.enum(['reader-panel', 'persistent-import']);
export const pluginManifestSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[a-z][a-zA-Z0-9]*(?:[.-][a-zA-Z0-9]+)*$/),
    name: z.string().trim().min(1).max(80),
    author: z.string().trim().min(1).max(120),
    version: z
      .string()
      .refine(
        (value) => value === value.trim() && /^\d/.test(value) && valid(value) !== null,
        'Invalid semantic version',
      ),
    apiVersion: z.literal(PLUGIN_API_VERSION),
    activation: z.union([activationSchema, z.array(activationSchema).min(1).max(2)]),
    format: z.enum(['EPUB', 'PDF']),
    capabilities: z
      .array(
        z.enum(['reading-harness', 'model-provider', 'verified-sources', 'local-pdf-contents']),
      )
      .max(4),
  })
  .strict();
export type PluginManifest = z.infer<typeof pluginManifestSchema>;

/** Trusted source registration only; external manifests cannot join the allowlist. */
export function defineBundledPlugin<const T extends PluginManifest>(manifest: T) {
  pluginManifestSchema.parse(manifest);
  return { ...manifest, labelKey: manifest.name };
}
