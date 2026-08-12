/**
 * The sole runtime switch for the Glossa scaffold.
 *
 * This is intentionally an exact opt-in. Keeping the flag here (rather than
 * distributing environment checks through reader code) ensures that adding
 * Glossa progressively cannot change Readest when the flag is absent.
 */
export const isGlossaEnabled = (): boolean => process.env['NEXT_PUBLIC_GLOSSA_ENABLED'] === 'true';
