/**
 * What a payment provider said when it refused a call, reduced to something
 * safe to log and store: a message and a code, with secrets and personal
 * data taken out. Provider SDKs put whatever they like into errors — the
 * request body, the API key in a URL, the buyer's email — so nothing beyond
 * the message and code is kept, and those two are scrubbed.
 */
export interface ProviderErrorSummary {
  message: string;
  code: string | null;
}

const MAX_MESSAGE_LENGTH = 500;

const REDACTIONS: Array<[RegExp, string]> = [
  // Emails
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]'],
  // Bearer / Basic credentials
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [redacted]'],
  // Key-looking query/header/JSON values: api_key=..., "secret": "...", token: ...
  [
    /\b(api[_-]?key|apikey|secret|token|password|authorization|x-api-key)(["']?\s*[:=]\s*["']?)[^\s"'&,}]+/gi,
    '$1$2[redacted]',
  ],
  // Stripe-style keys (sk_live_..., rk_test_..., whsec_...)
  [/\b(sk|rk|pk|whsec)_(live|test)?_?[A-Za-z0-9]{8,}/g, '[redacted-key]'],
  // Card-number-like digit runs (13-19 digits, optionally spaced/dashed)
  [/\b(?:\d[ -]?){12,18}\d\b/g, '[redacted-number]'],
  // Long opaque tokens (JWTs, hex/base64 secrets)
  [/\b[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted-token]'],
  [/\b[A-Za-z0-9+/_-]{40,}={0,2}/g, '[redacted-token]'],
];

export function redactProviderText(text: string): string {
  let out = text;
  for (const [pattern, replacement] of REDACTIONS) out = out.replace(pattern, replacement);
  return out.length > MAX_MESSAGE_LENGTH ? `${out.slice(0, MAX_MESSAGE_LENGTH)}…` : out;
}

export function summarizeProviderError(error: unknown): ProviderErrorSummary {
  const e = (error ?? {}) as Record<string, any>;
  const rawMessage =
    typeof e.message === 'string' && e.message
      ? e.message
      : typeof error === 'string'
        ? error
        : 'Unknown provider error';
  const rawCode =
    e.code ?? e.type ?? e.raw?.code ?? e.response?.status ?? e.status ?? e.statusCode ?? null;
  return {
    message: redactProviderText(rawMessage),
    code: rawCode === null || rawCode === undefined ? null : redactProviderText(String(rawCode)),
  };
}
