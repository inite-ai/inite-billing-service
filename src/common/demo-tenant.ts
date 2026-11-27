/**
 * The family's demo tenant, «Atlântica Group (demo)», as billing sees it.
 *
 * The source of truth is INITE Auth: `src/organizations/demo-tenant.ts` in
 * inite-auth-service fixes this id, and its demo grant issues tokens for three
 * personas of that organisation (Ana, owner; Bruno, admin; Carla, member) with
 * `demo: true` and `org_id` set to it. inite-shared repeats it as
 * `DEMO_ORG_ID` in `@inite/auth/demo`; this repository is public and cannot
 * import that package, so the id is pinned here and in
 * `frontend/lib/demo.ts`, and `test/demo-tenant.spec.ts` holds all three to it.
 *
 * Billing keys a company's rows by `org:<org_id>` (see `orgSubscriber`), so
 * every demo fixture belongs to `DEMO_SUBSCRIBER` and nothing else.
 *
 * No framework imports here: the one-off production seed
 * (prisma/demo-tenant/) bundles this file on its own.
 */
export const DEMO_ORG_ID = 'a7a71c00-de00-4000-8000-000000000001';
export const DEMO_ORG_NAME = 'Atlântica Group (demo)';

/** The one subscriber id demo fixtures are keyed by (`orgSubscriber(DEMO_ORG_ID)`). */
export const DEMO_SUBSCRIBER = `org:${DEMO_ORG_ID}`;

/** What every refusal of a demo write says, the code the family uses. */
export const DEMO_READ_ONLY = 'demo_read_only';

/** Whether a billing row's owner is the demo tenant. */
export function isDemoSubscriber(userId: string | null | undefined): boolean {
  return typeof userId === 'string' && userId.toLowerCase() === DEMO_SUBSCRIBER;
}

/**
 * Whether token claims are a demo session's. Either sign is enough: auth's
 * demo grant sets both, and a token of the demo organisation without the
 * flag is still not a real customer. Failing towards "demo" only ever makes
 * a request read-only.
 */
export function isDemoClaims(
  claims: { demo?: unknown; org_id?: unknown } | null | undefined,
): boolean {
  if (!claims) return false;
  if (claims.demo === true) return true;
  return typeof claims.org_id === 'string' && claims.org_id.toLowerCase() === DEMO_ORG_ID;
}
