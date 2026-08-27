export type SortDirection = 'asc' | 'desc';

/**
 * Where a sort key lives, as a path into Prisma's `orderBy`.
 *
 * `['amount']` becomes `{ amount: dir }`; `['price', 'product', 'name']`
 * becomes `{ price: { product: { name: dir } } }`; `['referrals', '_count']`
 * becomes `{ referrals: { _count: dir } }`.
 *
 * Deliberately data rather than a builder function. A whitelist of callables
 * means a name from a query string chooses which function runs, and both the
 * reader and the scanner then have to prove the choice is closed. Paths cannot
 * do anything when selected — they are just names to nest.
 */
export type SortPath = readonly string[];

export type SortWhitelist = Record<string, SortPath>;

/** `['a','b']` + `'asc'` → `{ a: { b: 'asc' } }`. */
function nest(path: SortPath, dir: SortDirection): any {
  return path.reduceRight<any>((inner, segment) => ({ [segment]: inner }), dir);
}

/**
 * Whitelists are written as object literals because that is the readable way to
 * declare them, but a client-supplied key is never used to index one: the
 * entries are copied into a `Map` (own enumerable properties only) and looked
 * up there. Indexing an object by an untrusted name reaches `constructor`,
 * `toString` and everything else on the prototype.
 *
 * Cached per whitelist, since each one is a module-level constant.
 */
const lookupTables = new WeakMap<SortWhitelist, Map<string, SortPath>>();

function lookup(allowed: SortWhitelist, key: string): SortPath | undefined {
  let table = lookupTables.get(allowed);
  if (!table) {
    table = new Map(Object.entries(allowed));
    lookupTables.set(allowed, table);
  }
  return table.get(key);
}

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
  const path = key ? lookup(allowed, key) : undefined;
  const dir: SortDirection = sortOrder?.trim().toLowerCase() === 'asc' ? 'asc' : 'desc';

  const primary = path ? nest(path, dir) : fallback;
  const tiebreak = { id: path ? dir : 'desc' };

  return Array.isArray(primary) ? [...primary, tiebreak] : [primary, tiebreak];
}

/** The sort keys a resource accepts — used in the `sortBy` API description. */
export function sortKeysOf(allowed: SortWhitelist): string {
  return Object.keys(allowed).join(' | ');
}
