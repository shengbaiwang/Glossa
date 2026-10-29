export interface LibrarySelectionOptions {
  toggle?: boolean;
  range?: boolean;
  preserve?: boolean;
  order?: string[];
}

/** File-style selection: replace, toggle, or extend from a stable anchor. */
export function resolveLibrarySelection(
  selected: string[],
  anchor: string | null,
  id: string,
  order: string[],
  options: LibrarySelectionOptions = {},
): { selected: string[]; anchor: string } {
  if (options.preserve && selected.includes(id)) return { selected, anchor: anchor ?? id };
  const from = anchor ? order.indexOf(anchor) : -1;
  const to = order.indexOf(id);
  if (options.range && from >= 0 && to >= 0) {
    const range = order.slice(Math.min(from, to), Math.max(from, to) + 1);
    return {
      selected: options.toggle ? [...new Set([...selected, ...range])] : range,
      anchor: anchor!,
    };
  }
  if (options.toggle) {
    return {
      selected: selected.includes(id) ? selected.filter((key) => key !== id) : [...selected, id],
      anchor: id,
    };
  }
  return { selected: [id], anchor: id };
}
