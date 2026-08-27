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
/**
 * Whitelists are written as object literals because that is the readable way to
 * declare them, but a client-supplied key is never used to index one: the
 * entries are copied into a `Map` (own enumerable properties only) and looked
 * up there. Indexing an object by an untrusted name reaches `constructor`,
 * `toString` and everything else on the prototype, and no `hasOwnProperty`
 * guard makes that obvious to a reader — or to a scanner.
 *
 * Cached per whitelist, since each one is a module-level constant.
 */
const lookupTables = new WeakMap<SortWhitelist, Map<string, SortBuilder>>();

function lookup(allowed: SortWhitelist, key: string): SortBuilder | undefined {
  let table = lookupTables.get(allowed);
  if (!table) {
    table = new Map(Object.entries(allowed));
    lookupTables.set(allowed, table);
  }
  return table.get(key);
}

export function resolveOrderBy(
  allowed: SortWhitelist,
  fallback: any,
  sortBy?: string,
  sortOrder?: string,
): any[] {
  const key = sortBy?.trim();
  const build = key ? lookup(allowed, key) : undefined;
  const dir: SortDirection = sortOrder?.trim().toLowerCase() === 'asc' ? 'asc' : 'desc';

  const primary = build ? build(dir) : fallback;
  const tiebreak = { id: build ? dir : 'desc' };

  return Array.isArray(primary) ? [...primary, tiebreak] : [primary, tiebreak];
}

/** The sort keys a resource accepts — used in the `sortBy` API description. */
export function sortKeysOf(allowed: SortWhitelist): string {
  return Object.keys(allowed).join(' | ');
}
