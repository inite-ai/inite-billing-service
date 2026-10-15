import { getAddress, getTypesForEIP712Domain, isAddress, isHex, serializeTypedData } from 'viem';
import { z } from 'zod';
import { CHAINS } from '../chains';

/**
 * x402 — paying an invoice of the crypto rail with a signed USDC
 * authorization instead of a transfer the customer sends themselves.
 *
 * The invoice is the rail's ordinary one: same wallet, same unique amount,
 * same ledger. What x402 changes is who puts the transfer on chain. The payer
 * (an AI agent, usually) signs an EIP-3009 `transferWithAuthorization` for
 * exactly the invoiced amount to our wallet; we check it and submit it, paying
 * the network fee. The watcher then sees the transfer like any other and
 * settles the order once it is final.
 *
 * Both protocol versions are spoken: v2 (headers `PAYMENT-REQUIRED`,
 * `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE`, CAIP-2 networks) and v1 (JSON body,
 * `X-PAYMENT`, `X-PAYMENT-RESPONSE`, network names) — agents in the wild use both.
 */

export const X402_HEADERS = {
  required: 'PAYMENT-REQUIRED',
  signature: 'payment-signature',
  response: 'PAYMENT-RESPONSE',
  v1Payment: 'x-payment',
  v1Response: 'X-PAYMENT-RESPONSE',
} as const;

/** Where x402 settles: Base, USDC — the one pair with an EIP-3009 token and cheap fees. */
export const X402_CHAIN = 'BASE' as const;
export const X402_TOKEN = 'USDC' as const;
export const X402_NETWORK = `eip155:${CHAINS.BASE.evm!.chainId}`;
export const X402_NETWORK_V1 = 'base';
/** USDC's EIP-712 domain on Base: `name()` and `version()` of the contract. */
export const USDC_DOMAIN = { name: 'USD Coin', version: '2' } as const;

/** An authorization must stay valid at least this long, or it may expire in flight. */
export const MIN_VALIDITY_SECONDS = 30;

export interface X402Invoice {
  /** The amount the invoice waits for, in USDC's smallest unit. */
  amountRaw: string;
  receiverAddress: string;
  expiresAt: Date;
}

export interface X402Resource {
  url: string;
  description: string;
}

export function usdcAddress(): `0x${string}` {
  return CHAINS.BASE.tokens.USDC!.contractAddress as `0x${string}`;
}

function timeout(invoice: X402Invoice, now: Date): number {
  return Math.max(
    MIN_VALIDITY_SECONDS,
    Math.floor((invoice.expiresAt.getTime() - now.getTime()) / 1000),
  );
}

/** The v2 `PaymentRequired` object, sent base64-encoded in `PAYMENT-REQUIRED`. */
export function paymentRequired(
  invoice: X402Invoice,
  resource: X402Resource,
  now = new Date(),
  error?: string,
) {
  return {
    x402Version: 2,
    ...(error ? { error } : {}),
    resource: {
      url: resource.url,
      description: resource.description,
      mimeType: 'application/json',
    },
    accepts: [
      {
        scheme: 'exact',
        network: X402_NETWORK,
        amount: invoice.amountRaw,
        asset: usdcAddress(),
        payTo: getAddress(invoice.receiverAddress),
        maxTimeoutSeconds: timeout(invoice, now),
        extra: { ...USDC_DOMAIN },
      },
    ],
  };
}

/** The same terms as a v1 body. */
export function paymentRequiredV1(
  invoice: X402Invoice,
  resource: X402Resource,
  now = new Date(),
  error?: string,
) {
  return {
    x402Version: 1,
    error: error ?? 'Payment required',
    accepts: [
      {
        scheme: 'exact',
        network: X402_NETWORK_V1,
        maxAmountRequired: invoice.amountRaw,
        resource: resource.url,
        description: resource.description,
        mimeType: 'application/json',
        payTo: getAddress(invoice.receiverAddress),
        maxTimeoutSeconds: timeout(invoice, now),
        asset: usdcAddress(),
        extra: { ...USDC_DOMAIN },
      },
    ],
  };
}

const hex = (bytes?: number) =>
  z
    .string()
    .refine((v) => isHex(v) && (bytes === undefined || v.length === 2 + bytes * 2), 'not hex');
const uint = z
  .union([z.string(), z.number()])
  .transform((v) => String(v))
  .refine((v) => /^\d{1,78}$/.test(v), 'not an integer');
const address = z.string().refine((v) => isAddress(v, { strict: false }), 'not an address');

const exactPayload = z.object({
  signature: hex(),
  authorization: z.object({
    from: address,
    to: address,
    value: uint,
    validAfter: uint,
    validBefore: uint,
    nonce: hex(32),
  }),
});

const payloadV2 = z.object({
  x402Version: z.literal(2),
  accepted: z
    .object({ scheme: z.string(), network: z.string(), asset: z.string().optional() })
    .passthrough(),
  payload: exactPayload,
});

const payloadV1 = z.object({
  x402Version: z.literal(1),
  scheme: z.string(),
  network: z.string(),
  payload: exactPayload,
});

export type Authorization = {
  from: `0x${string}`;
  to: `0x${string}`;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: `0x${string}`;
};

export interface DecodedPayment {
  version: 1 | 2;
  scheme: string;
  network: string;
  asset?: string;
  authorization: Authorization;
  signature: `0x${string}`;
}

export class X402Error extends Error {
  constructor(
    /** Machine-readable, sent back as `errorReason`. */
    readonly reason: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Read the payment an agent attached: `PAYMENT-SIGNATURE` (v2) or
 * `X-PAYMENT` (v1), base64 JSON. Null when there is none.
 */
export function decodePayment(
  headers: Record<string, string | string[] | undefined>,
): DecodedPayment | null {
  const pick = (name: string) => {
    const v = headers[name] ?? headers[name.toLowerCase()];
    return Array.isArray(v) ? v[0] : v;
  };
  const raw = pick(X402_HEADERS.signature) ?? pick(X402_HEADERS.v1Payment);
  if (!raw) return null;

  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
  } catch {
    throw new X402Error('invalid_payload', 'The payment header is not base64-encoded JSON');
  }
  const v2 = payloadV2.safeParse(json);
  const v1 = v2.success ? null : payloadV1.safeParse(json);
  if (!v2.success && !v1?.success) {
    throw new X402Error('invalid_payload', 'The payment header is not an x402 "exact" EVM payment');
  }
  const body = v2.success
    ? {
        version: 2 as const,
        scheme: v2.data.accepted.scheme,
        network: v2.data.accepted.network,
        asset: v2.data.accepted.asset,
        payload: v2.data.payload,
      }
    : {
        version: 1 as const,
        scheme: v1!.data!.scheme,
        network: v1!.data!.network,
        asset: undefined,
        payload: v1!.data!.payload,
      };
  const a = body.payload.authorization;
  return {
    version: body.version,
    scheme: body.scheme,
    network: body.network,
    asset: body.asset,
    signature: body.payload.signature as `0x${string}`,
    authorization: {
      from: getAddress(a.from),
      to: getAddress(a.to),
      value: BigInt(a.value),
      validAfter: BigInt(a.validAfter),
      validBefore: BigInt(a.validBefore),
      nonce: a.nonce.toLowerCase() as `0x${string}`,
    },
  };
}

/**
 * Does this authorization pay this invoice? Everything that can be checked
 * without the chain: scheme, network, token, our wallet, the exact amount — the
 * amount is what the watcher matches the transfer to the invoice by, so
 * "at least" is not enough — and a validity window that is open now and will
 * not close before the transfer lands.
 */
export function checkAuthorization(
  payment: DecodedPayment,
  invoice: X402Invoice,
  now = new Date(),
): void {
  if (payment.scheme !== 'exact') {
    throw new X402Error(
      'unsupported_scheme',
      `Only the "exact" scheme is accepted, not "${payment.scheme}"`,
    );
  }
  const network = payment.version === 2 ? X402_NETWORK : X402_NETWORK_V1;
  if (payment.network !== network) {
    throw new X402Error('invalid_network', `Pay on ${network}, not ${payment.network}`);
  }
  if (payment.asset && payment.asset.toLowerCase() !== usdcAddress().toLowerCase()) {
    throw new X402Error('invalid_asset', 'Only USDC on Base is accepted');
  }
  const a = payment.authorization;
  if (a.to.toLowerCase() !== invoice.receiverAddress.toLowerCase()) {
    throw new X402Error('invalid_recipient', 'The authorization pays someone else');
  }
  if (a.value !== BigInt(invoice.amountRaw)) {
    throw new X402Error(
      'invalid_amount',
      `The authorization is for ${a.value}, the invoice is for exactly ${invoice.amountRaw}`,
    );
  }
  const seconds = BigInt(Math.floor(now.getTime() / 1000));
  if (a.validAfter > seconds) {
    throw new X402Error('not_yet_valid', 'The authorization is not valid yet');
  }
  if (a.validBefore < seconds + BigInt(MIN_VALIDITY_SECONDS)) {
    throw new X402Error('expired', 'The authorization expires too soon to be settled');
  }
}

/** The typed data the payer signed, for checking the signature. */
export function typedData(a: Authorization) {
  return {
    domain: { ...USDC_DOMAIN, chainId: CHAINS.BASE.evm!.chainId, verifyingContract: usdcAddress() },
    types: {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
      ],
    } as const,
    primaryType: 'TransferWithAuthorization' as const,
    message: a,
  };
}

/**
 * The authorization's typed data as JSON, for a signer that takes EIP-712
 * text (Turnkey's PAYLOAD_ENCODING_EIP712). The domain's own type is spelled
 * out: without it viem leaves the domain empty, and the signature would be
 * for a different message than the one USDC checks.
 */
export function typedDataPayload(a: Authorization): string {
  const data = typedData(a);
  return serializeTypedData({
    ...data,
    types: { EIP712Domain: getTypesForEIP712Domain({ domain: data.domain }), ...data.types },
  } as any);
}

/** The settlement answer, sent base64-encoded in `PAYMENT-RESPONSE` / `X-PAYMENT-RESPONSE`. */
export function settlementResponse(input: {
  success: boolean;
  transaction?: string | null;
  payer?: string;
  amount?: string;
  errorReason?: string;
  version: 1 | 2;
}) {
  return {
    success: input.success,
    ...(input.errorReason ? { errorReason: input.errorReason } : {}),
    ...(input.payer ? { payer: input.payer } : {}),
    transaction: input.transaction ?? '',
    network: input.version === 2 ? X402_NETWORK : X402_NETWORK_V1,
    ...(input.amount ? { amount: input.amount } : {}),
  };
}

export const encodeHeader = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString('base64');
