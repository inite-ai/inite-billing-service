import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { LookupFunction } from 'node:net';
import { isIP } from 'node:net';

export interface PinnedPostResult {
  status: number;
  statusText: string;
  ok: boolean;
}

/** Response bodies are read only to drain the socket; nothing needs them. */
const MAX_DRAIN_BYTES = 64 * 1024;

/**
 * A DNS lookup that answers with one address the caller has already vetted,
 * without consulting a resolver.
 *
 * The SSRF guard resolves a webhook host and rejects it if any address is
 * private — and then the HTTP client used to resolve the same name a second
 * time. Between those two resolutions the answer can change: a hostname whose
 * record has a one-second TTL can return a public address to the check and
 * 169.254.169.254 to the connection. Pinning removes the second lookup, so the
 * address that was approved is the address that is dialled.
 */
export function createPinnedLookup(address: string): LookupFunction {
  const family = isIP(address);
  if (family === 0) throw new Error(`Pinned address is not an IP literal: ${address}`);

  return ((hostname: string, options: any, callback: any) => {
    // Node calls this with `all: true` from some paths and `all: false` from
    // others; answering in the wrong shape silently fails the connection.
    if (options && options.all) {
      process.nextTick(callback, null, [{ address, family }]);
    } else {
      process.nextTick(callback, null, address, family);
    }
  }) as unknown as LookupFunction;
}

/**
 * POST a body to a URL, connecting only to an address that has already been
 * checked.
 *
 * TLS still verifies against the hostname: the socket dials the pinned IP but
 * SNI and certificate validation use `servername`, so pinning does not weaken
 * the certificate check.
 *
 * Redirects are not followed — `node:http` does not follow them, and a 3xx is
 * returned as an ordinary non-ok status. A public URL that answers with a
 * redirect into a private target would otherwise walk straight around the
 * guard.
 */
export async function postToPinnedAddress(params: {
  url: string;
  /** Vetted addresses, tried in order — a host with several A records still
   *  gets the failover the resolver would have given it. */
  addresses: string[];
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}): Promise<PinnedPostResult> {
  const { addresses } = params;
  if (addresses.length === 0) throw new Error('No vetted address to deliver to');

  let lastError: unknown;
  for (const address of addresses) {
    try {
      return await postToOneAddress({ ...params, address });
    } catch (error) {
      // Only a failure to reach this address is worth trying the next one for;
      // an HTTP status comes back as a resolved result, not a throw.
      lastError = error;
    }
  }
  throw lastError;
}

function postToOneAddress(params: {
  url: string;
  address: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}): Promise<PinnedPostResult> {
  const { url, address, headers, body, timeoutMs } = params;
  const parsed = new URL(url);
  const secure = parsed.protocol === 'https:';
  const request = secure ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const req = request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname.replace(/^\[|\]$/g, ''),
        port: parsed.port || (secure ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method: 'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(body).toString() },
        lookup: createPinnedLookup(address),
        // `setTimeout` below is socket inactivity, which does not bound a
        // connect that never completes — an unroutable address would otherwise
        // hold the worker for the OS's own TCP timeout. The signal covers the
        // whole attempt.
        signal: AbortSignal.timeout(timeoutMs),
        ...(secure ? { servername: parsed.hostname } : {}),
      },
      (res) => {
        let drained = 0;
        res.on('data', (chunk: Buffer) => {
          drained += chunk.length;
          if (drained > MAX_DRAIN_BYTES) res.destroy();
        });
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          resolve({
            status,
            statusText: res.statusMessage ?? '',
            ok: status >= 200 && status < 300,
          });
        });
        res.on('error', reject);
      },
    );

    const timedOut = () => new Error(`Webhook delivery timed out after ${timeoutMs}ms`);

    req.setTimeout(timeoutMs, () => req.destroy(timedOut()));
    req.on('error', (error: Error) => {
      // The deadline can arrive as either mechanism depending on which phase
      // the request is in; the log should read the same way either way.
      reject(error.name === 'AbortError' ? timedOut() : error);
    });
    req.end(body);
  });
}
