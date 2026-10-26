/** Drop the retired subject fields from parsed, legacy or remote book metadata. */
export function removeBookSubjectMetadata<T extends object>(metadata: T): T {
  if (!('subject' in metadata) && !('subjects' in metadata)) return metadata;
  const cleaned = { ...metadata };
  Reflect.deleteProperty(cleaned, 'subject');
  Reflect.deleteProperty(cleaned, 'subjects');
  return cleaned;
}
