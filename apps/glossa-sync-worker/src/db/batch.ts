// SQL templates are internal constants. Bind all caller-provided values.
export type Bind = string | number | null | ArrayBuffer;
export const MAX_BINDS = 90;

export function statement(db: D1Database, sql: string, ...values: Bind[]) {
  if (values.length > MAX_BINDS) throw new RangeError('D1 binding budget exceeded');
  const prepared = db.prepare(sql);
  return values.length ? prepared.bind(...values) : prepared;
}

// Return statements so the caller can include guards and other writes in the same DB.batch.
export function chunkedBatch<T>(
  db: D1Database,
  rows: readonly T[],
  fixed: readonly Bind[],
  rowBindings: (row: T) => readonly Bind[],
  sql: (placeholders: string[]) => string,
): D1PreparedStatement[] {
  if (!rows.length) return [];
  const width = rowBindings(rows[0]!).length;
  const capacity = Math.floor((MAX_BINDS - fixed.length) / width);
  if (!width || capacity < 1) throw new RangeError('Row exceeds the D1 binding budget');
  const statements = [];
  for (let i = 0; i < rows.length; i += capacity) {
    const group = rows.slice(i, i + capacity).map(rowBindings);
    if (group.some((values) => values.length !== width))
      throw new RangeError('Inconsistent row width');
    const slots = group.map(() => Array(width).fill('?').join(','));
    statements.push(statement(db, sql(slots), ...fixed, ...group.flat()));
  }
  return statements;
}

export function guard(db: D1Database, predicate: string, ...values: Bind[]) {
  return statement(
    db,
    `INSERT INTO write_guard(ok)
    VALUES (CASE WHEN (${predicate}) THEN 1 ELSE 0 END)
    ON CONFLICT(ok) DO NOTHING`,
    ...values,
  );
}

export function isGuardFailure(error: unknown): boolean {
  return error instanceof Error && /CHECK constraint failed: ok\s*=\s*1/i.test(error.message);
}
