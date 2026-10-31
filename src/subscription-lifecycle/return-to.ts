/**
 * Where the customer page sends a person back to: only an https address on
 * one of the service's own origins (`Service.metadata.allowedOrigins`, set by
 * an admin). Anything else is dropped, never followed: billing's page is
 * signed in, and a link back to an address a stranger chose would be an open
 * redirect carrying that trust.
 */
export function allowedOriginsOf(metadata: unknown): string[] {
  const list = (metadata as Record<string, unknown> | null)?.allowedOrigins;
  if (!Array.isArray(list)) return [];
  const origins: string[] = [];
  for (const entry of list) {
    if (typeof entry !== 'string') continue;
    try {
      const url = new URL(entry.trim());
      if (url.protocol !== 'https:') continue;
      origins.push(url.origin);
    } catch {
      continue;
    }
  }
  return origins;
}

export function validReturnTo(value: unknown, allowedOrigins: string[]): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2000) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  // Credentials in a URL are a phishing tell and never a return address.
  if (url.username || url.password) return null;
  if (!allowedOrigins.includes(url.origin)) return null;
  return url.toString();
}
