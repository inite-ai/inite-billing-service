import { isOrgSubscriber, orgSubscriber } from '../common/validators/is-user-id';

/**
 * Whose plans a signed-in person sees and moves on billing's own pages.
 *
 * A company's plan is held by its organisation at INITE Auth (`org:<org_id>`),
 * not by whoever bought it. The person sees their own plans (their DID) and
 * those of the organisation their verified token names (`org_id`); only an
 * `owner` or `admin` of it (`org_role`) cancels, resumes or changes the
 * organisation's plan. A member sees it and nothing more. Everything comes
 * from the verified token, never from the request.
 */

/** The roles in an organisation that may change or cancel its plan. */
export const ORG_MANAGER_ROLES: readonly string[] = ['owner', 'admin'];

/** An organisation's plan that this person may see but not move. */
export const ORG_MANAGERS_ONLY =
  'Only an owner or admin of the organisation can change or cancel its plan';

export interface SubscriberCaller {
  userId: string;
  orgId?: string;
  orgRole?: string;
}

/** The token's organisation as a subscriber, or null. */
export function callerOrg(caller: SubscriberCaller): string | null {
  return caller.orgId ? orgSubscriber(caller.orgId) : null;
}

/** Every subscriber whose plans the person sees: themselves, then their organisation. */
export function visibleSubscribers(caller: SubscriberCaller): string[] {
  const org = callerOrg(caller);
  return org ? [caller.userId, org] : [caller.userId];
}

/** Whether the person may cancel, resume or change a plan held by `subscriber`. */
export function mayManage(caller: SubscriberCaller, subscriber: string): boolean {
  if (subscriber === caller.userId) return true;
  if (!isOrgSubscriber(subscriber)) return false;
  return (
    subscriber.toLowerCase() === callerOrg(caller) &&
    ORG_MANAGER_ROLES.includes((caller.orgRole ?? '').toLowerCase())
  );
}

/** The subscribers whose plans the person may move. */
export function manageableSubscribers(caller: SubscriberCaller): string[] {
  return visibleSubscribers(caller).filter((s) => mayManage(caller, s));
}
