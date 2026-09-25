import { ChainId } from '../chains';

/** One incoming token transfer to a watched wallet, as a chain reported it. */
export interface IncomingTransfer {
  chain: ChainId;
  txHash: string;
  token: string;
  from?: string | null;
  to: string;
  /** In the token's smallest unit. */
  amountRaw: string;
  decimals: number;
  confirmations: number;
  /** Past the point the chain can reverse it. */
  isFinal: boolean;
  blockTime?: Date | null;
}

export interface WatchQuery {
  receiver: string;
  token: string;
  contractAddress: string;
  decimals: number;
  requiredConfirmations: number;
  /** Nothing older than this is of interest. */
  since: Date;
  /** Transactions already recorded as final — a watcher may skip re-reading them. */
  finalTxHashes: Set<string>;
}

export interface ChainWatcher {
  chain: ChainId;
  incoming(query: WatchQuery): Promise<IncomingTransfer[]>;
}

export class WatcherHttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 15_000;

/** GET or POST JSON with a timeout; a non-2xx answer is an error with its status. */
export async function fetchJson<T>(
  url: string,
  init: { method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(url, {
    method: init.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new WatcherHttpError(`${new URL(url).host} answered ${response.status}`, response.status);
  }
  return (await response.json()) as T;
}
