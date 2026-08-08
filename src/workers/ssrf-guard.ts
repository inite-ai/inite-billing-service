import { isIP } from 'net';
import { lookup } from 'dns/promises';

/**
 * Whether an IPv4 literal falls in a private / loopback / link-local / reserved
 * range that must never be a webhook target. Malformed input is treated as
 * unsafe (fail closed).
 */
export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8 "this host"
  if (a === 10) return true; // 10/8 private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local (incl. cloud metadata 169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 private
  if (a === 192 && b === 168) return true; // 192.168/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a === 192 && b === 0) return true; // 192.0.0/24 + 192.0.2/24 (IETF/TEST-NET-1)
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 benchmarking
  if (a >= 224) return true; // 224/4 multicast + 240/4 reserved + 255.255.255.255
  return false;
}

/**
 * Whether an IP literal (v4 or v6) is private / loopback / link-local / reserved.
 * Handles IPv4-mapped IPv6 (`::ffff:a.b.c.d`). Non-IP input is unsafe.
 */
export function isPrivateAddress(ip: string): boolean {
  const addr = ip
    .replace(/^\[|\]$/g, '')
    .trim()
    .toLowerCase();
  const kind = isIP(addr);
  if (kind === 4) return isPrivateIPv4(addr);
  if (kind === 6) {
    if (addr === '::1' || addr === '::') return true; // loopback / unspecified
    // IPv4-mapped or -embedded (e.g. ::ffff:127.0.0.1) — validate the v4 tail.
    const mapped = addr.match(/(?:^|:)((?:\d{1,3}\.){3}\d{1,3})$/);
    if (mapped) return isPrivateIPv4(mapped[1]);
    if (/^fe[89ab]/.test(addr)) return true; // fe80::/10 link-local
    if (/^f[cd]/.test(addr)) return true; // fc00::/7 unique-local
    if (/^ff/.test(addr)) return true; // ff00::/8 multicast
    return false;
  }
  return true; // not an IP literal → fail closed
}

export interface UrlGuardResult {
  ok: boolean;
  reason?: string;
  /** Addresses the host resolved to (for pinning / logging). */
  addresses?: string[];
}

/**
 * SSRF guard for outbound webhook URLs. Unlike a hostname-string check, this
 * resolves the host and validates EVERY resulting address against private
 * ranges — closing the "public hostname that resolves to 127.0.0.1 / the cloud
 * metadata IP" hole. Combine with `redirect: 'manual'` so a public URL can't
 * 3xx-redirect into a private target after the check.
 */
export async function assertPublicUrl(rawUrl: string): Promise<UrlGuardResult> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'unsupported_protocol' };
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, '');

  // Literal IP host: validate directly, no DNS.
  if (isIP(host)) {
    return isPrivateAddress(host)
      ? { ok: false, reason: 'private_ip', addresses: [host] }
      : { ok: true, addresses: [host] };
  }

  // Names that never legitimately resolve to a public webhook endpoint.
  if (/^localhost$/i.test(host) || /\.local$/i.test(host) || host === 'metadata.google.internal') {
    return { ok: false, reason: 'private_host' };
  }

  let resolved: Array<{ address: string }>;
  try {
    resolved = await lookup(host, { all: true });
  } catch {
    return { ok: false, reason: 'dns_resolution_failed' };
  }
  if (resolved.length === 0) return { ok: false, reason: 'dns_no_records' };

  const addresses = resolved.map((r) => r.address);
  for (const address of addresses) {
    if (isPrivateAddress(address)) {
      return { ok: false, reason: 'resolves_to_private', addresses };
    }
  }
  return { ok: true, addresses };
}
