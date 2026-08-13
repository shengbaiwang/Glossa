export type GlossaRuntimeIdentity = {
  enabled: boolean;
  expectedIdentifier?: string;
  actualIdentifier?: string;
  portable: boolean;
};

/**
 * Keeps the Glossa development feature from running under Readest's runtime
 * identity. This is pure so it can be tested without creating any app data.
 */
export const getGlossaRuntimeSafetyError = ({
  enabled,
  expectedIdentifier,
  actualIdentifier,
  portable,
}: GlossaRuntimeIdentity): string | null => {
  if (!enabled) return null;
  if (!expectedIdentifier) {
    return 'Glossa is enabled without an isolated runtime identity. Start it with `pnpm dev:glossa`.';
  }
  if (portable) {
    return 'Glossa development mode cannot use portable storage because it can collide with the development executable. Start it with `pnpm dev:glossa`.';
  }
  if (actualIdentifier && actualIdentifier !== expectedIdentifier) {
    return `Glossa runtime identity mismatch: expected ${expectedIdentifier}, received ${actualIdentifier}. Start it with \`pnpm dev:glossa\`.`;
  }
  return null;
};
