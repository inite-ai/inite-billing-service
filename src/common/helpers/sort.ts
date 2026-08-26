export type SortDirection = 'asc' | 'desc';

/** Builds a Prisma `orderBy` fragment for one whitelisted sort key. */
export type SortBuilder = (dir: SortDirection) => any;

export type SortWhitelist = Record<string, SortBuilder>;

/**
 * Turn a client-supplied `sortBy`/`sortOrder` pair into a Prisma `orderBy`.
 *
 * Two rules every admin list endpoint depends on. The key must come from a
 * per-resource whitelist, because an arbitrary string would reach Prisma as a
 * column name. And an unrecognised key falls back to the resource's default
 * ordering instead of throwing: a bookmarked URL that outlives a column rename
 * should still render the table, not a 500.
 *
 * Every result ends with an `id` tiebreaker. Without one, a page boundary
 * falling inside a run of equal values — twenty payouts created in the same
 * batch, a column of identical statuses — lets Postgres return a different
 * order for each OFFSET, so a record can appear on both page 1 and page 2 while
 * another is never shown at all.
 */
export function resolveOrderBy(
  allowed: SortWhitelist,
  fallback: any,
  sortBy?: string,
  sortOrder?: string,
): any[] {
  const key = sortBy?.trim();
  const known = !!key && Object.prototype.hasOwnProperty.call(allowed, key);
  const dir: SortDirection = sortOrder?.trim().toLowerCase() === 'asc' ? 'asc' : 'desc';

  const primary = known ? allowed[key as string](dir) : fallback;
  const tiebreak = { id: known ? dir : 'desc' };

  return Array.isArray(primary) ? [...primary, tiebreak] : [primary, tiebreak];
}

/** The sort keys a resource accepts — used in the `sortBy` API description. */
export function sortKeysOf(allowed: SortWhitelist): string {
  return Object.keys(allowed).join(' | ');
}
