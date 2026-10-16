/**
 * Agents on their own: an AI agent that registered itself with INITE Auth
 * using its own key, with no person behind it. Its access tokens carry its
 * did:web as `sub` (did:web:<auth host>:agents:dcr_<id>), and the DID document
 * at <issuer>/agents/<id>/did.json publishes its public key.
 *
 * Its INITE wallet is a Turnkey sub-organization whose only root user is
 * that same key. Billing opens it and prepares requests; only the agent's
 * stamp makes Turnkey sign. Whoever funds the address funds the agent.
 */

const SELF_AGENT_ID = /^dcr_[0-9a-f]{32}$/;

export class SelfAgentError extends Error {}

/** did:web for an id under the issuer, as INITE Auth writes it. */
export function agentDid(issuer: string, agentId: string): string {
  const url = new URL(issuer);
  const host = url.port ? `${url.hostname}%3A${url.port}` : url.hostname;
  const path = url.pathname.replace(/^\/+|\/+$/g, '');
  return ['did:web', host, ...(path ? path.split('/') : []), 'agents', agentId].join(':');
}

/** The agent's id when `did` is a self-registered agent of this issuer, else null. */
export function selfAgentId(did: string, issuer: string): string | null {
  const id = did.split(':').pop() ?? '';
  return SELF_AGENT_ID.test(id) && did === agentDid(issuer, id) ? id : null;
}

const b64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** A P-256 public JWK as Turnkey takes API keys: compressed point, hex. */
export function compressedP256(jwk: Record<string, unknown>): string {
  if (
    jwk.kty !== 'EC' ||
    jwk.crv !== 'P-256' ||
    typeof jwk.x !== 'string' ||
    typeof jwk.y !== 'string'
  ) {
    throw new SelfAgentError('The agent key must be an EC P-256 key');
  }
  const x = b64url(jwk.x);
  const y = b64url(jwk.y);
  if (x.length !== 32 || y.length !== 32) throw new SelfAgentError('Not a P-256 point');
  const prefix = (y[31]! & 1) === 1 ? '03' : '02';
  return prefix + x.toString('hex');
}

/**
 * The agent's P-256 key, from its DID document at INITE Auth, or null when it
 * registered with a client secret and has no key. Fetched from the issuer
 * only, never from a URL the caller chose.
 */
export async function resolveAgentKey(
  did: string,
  issuer: string,
  fetchFn: typeof fetch = fetch,
): Promise<string | null> {
  const id = selfAgentId(did, issuer);
  if (!id) throw new SelfAgentError('Not an agent registered on its own');
  const url = `${issuer.replace(/\/$/, '')}/agents/${id}/did.json`;
  const response = await fetchFn(url, { signal: AbortSignal.timeout(10_000) });
  if (response.status === 410) throw new SelfAgentError('This agent was deactivated');
  if (!response.ok)
    throw new SelfAgentError(`The agent's DID document could not be read (${response.status})`);
  const document = (await response.json()) as {
    id?: string;
    verificationMethod?: Array<{ publicKeyJwk?: Record<string, unknown> }>;
  };
  if (document.id !== did) throw new SelfAgentError('The DID document is for another agent');
  const jwk = document.verificationMethod?.find(
    (m) => m.publicKeyJwk?.kty === 'EC' && m.publicKeyJwk?.crv === 'P-256',
  )?.publicKeyJwk;
  return jwk ? compressedP256(jwk) : null;
}

/**
 * A stamp the agent made with its key, as Turnkey's ApiKeyStamper writes the
 * X-Stamp header: base64url JSON { publicKey, scheme, signature }. Refused
 * here when it is not by the wallet's owner key; Turnkey checks the signature.
 */
export function checkKeyStamp(stamp: string, ownerKey: string): void {
  let parsed: any = null;
  try {
    parsed =
      typeof stamp === 'string' && stamp.length < 4_096
        ? JSON.parse(b64url(stamp).toString('utf8'))
        : null;
  } catch {
    parsed = null;
  }
  if (
    !parsed ||
    parsed.scheme !== 'SIGNATURE_SCHEME_TK_API_P256' ||
    typeof parsed.signature !== 'string' ||
    typeof parsed.publicKey !== 'string'
  ) {
    throw new SelfAgentError('A stamp by the agent key is required (Turnkey X-Stamp, P-256)');
  }
  if (parsed.publicKey.toLowerCase() !== ownerKey.toLowerCase()) {
    throw new SelfAgentError('The stamp is not by the key that owns this wallet');
  }
}
