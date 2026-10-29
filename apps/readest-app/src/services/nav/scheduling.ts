export interface NavBuildOptions {
  signal?: AbortSignal;
  background?: boolean;
}

export const assertNavActive = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw new DOMException('Navigation build cancelled', 'AbortError');
};

/** Give the displayed page an event-loop turn between background section reads. */
export const yieldNavBuild = async (options: NavBuildOptions): Promise<void> => {
  assertNavActive(options.signal);
  if (options.background) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assertNavActive(options.signal);
};
