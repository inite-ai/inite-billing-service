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
 * Parse an IPv6 literal into its eight 16-bit groups, expanding `::` and a
 * dotted IPv4 tail. Returns null for anything that is not a valid IPv6 literal.
 */
function ipv6Groups(addr: string): number[] | null {
  if (isIP(addr) !== 6) return null;
  let text = addr.replace(/%.*$/, ''); // zone id (fe80::1%eth0)
  const dotted = text.match(/^(.*:)((?:\d{1,3}\.){3}\d{1,3})$/);
  if (dotted) {
    const v4 = dotted[2].split('.').map(Number);
    text =
      dotted[1] + ((v4[0] << 8) | v4[1]).toString(16) + ':' + ((v4[2] << 8) | v4[3]).toString(16);
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail].map(
    (g) => parseInt(g, 16),
  );
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff)
    ? groups
    : null;
}

function v4From(hi: number, lo: number): string {
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

/**
 * Whether an IP literal (v4 or v6) is private / loopback / link-local / reserved.
 * Non-IP input is unsafe.
 *
 * IPv6 is compared by value, not by spelling. `new URL()` rewrites
 * `[::ffff:127.0.0.1]` to `[::ffff:7f00:1]`, so a check that only recognised
 * the dotted form let every IPv4-mapped private address through — the
 * metadata service as `[::ffff:a9fe:a9fe]`, loopback as `[::ffff:7f00:1]`.
 * Every IPv6 form that carries an IPv4 address (mapped, compatible,
 * translated, NAT64, 6to4) is judged by the IPv4 address it carries.
 */
export function isPrivateAddress(ip: string): boolean {
  const addr = ip
    .replace(/^\[|\]$/g, '')
    .trim()
    .toLowerCase();
  const kind = isIP(addr.replace(/%.*$/, ''));
  if (kind === 4) return isPrivateIPv4(addr);
  if (kind === 6) {
    const g = ipv6Groups(addr);
    if (!g) return true;
    const zeroTo = (n: number) => g.slice(0, n).every((x) => x === 0);
    // ::/96 (unspecified, loopback, IPv4-compatible) and ::ffff:0:0/96 (mapped)
    if (zeroTo(5) && (g[5] === 0 || g[5] === 0xffff)) {
      if (g[5] === 0 && g[6] === 0) return true; // ::, ::1 and the rest of ::/112
      return isPrivateIPv4(v4From(g[6], g[7]));
    }
    // ::ffff:0:a.b.c.d (IPv4-translated, RFC 2765)
    if (zeroTo(4) && g[4] === 0xffff && g[5] === 0) return isPrivateIPv4(v4From(g[6], g[7]));
    // 64:ff9b::/96 (NAT64 well-known prefix)
    if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
      return isPrivateIPv4(v4From(g[6], g[7]));
    }
    if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return true; // 64:ff9b:1::/48 local NAT64
    if (g[0] === 0x2002) return isPrivateIPv4(v4From(g[1], g[2])); // 6to4
    if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo: the IPv4 inside is obfuscated
    if (g[0] === 0x2001 && g[1] === 0xdb8) return true; // documentation
    if (g[0] === 0x100 && zeroTo(4)) return true; // 100::/64 discard
    if ((g[0] & 0xff80) === 0xfe80) return true; // fe80::/9 link-local + old site-local
    if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
    if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
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
