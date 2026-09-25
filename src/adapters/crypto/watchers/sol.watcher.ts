import { ChainWatcher, IncomingTransfer, WatchQuery, WatcherHttpError, fetchJson } from './types';

interface RpcAnswer<T> {
  result?: T;
  error?: { code: number; message: string };
}

interface TokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string; decimals: number };
}

/** Signatures looked at per token account per poll. */
const SIGNATURE_WINDOW = 25;

/**
 * SPL token transfers into a wallet, over Solana JSON-RPC.
 *
 * A wallet receives a token in an associated token account it owns, so the
 * watcher lists those accounts for the mint, reads their recent finalized
 * signatures, and for each transaction takes the change in the wallet's token
 * balance. A balance delta rather than a parsed instruction, because it is
 * right whatever program moved the tokens — a plain transfer, a
 * transferChecked, a swap that paid out to us.
 */
export class SolWatcher implements ChainWatcher {
  readonly chain = 'SOL' as const;

  constructor(private readonly rpcUrl = 'https://api.mainnet-beta.solana.com') {}

  private async rpc<T>(method: string, params: unknown[]): Promise<T> {
    const answer = await fetchJson<RpcAnswer<T>>(this.rpcUrl, {
      method: 'POST',
      body: { jsonrpc: '2.0', id: 1, method, params },
    });
    if (answer.error) throw new WatcherHttpError(`Solana RPC ${method}: ${answer.error.message}`);
    return answer.result as T;
  }

  async incoming(query: WatchQuery): Promise<IncomingTransfer[]> {
    const accounts = await this.rpc<{ value: Array<{ pubkey: string }> }>(
      'getTokenAccountsByOwner',
      [
        query.receiver,
        { mint: query.contractAddress },
        { encoding: 'jsonParsed', commitment: 'finalized' },
      ],
    );

    const sinceSeconds = Math.floor(query.since.getTime() / 1000);
    const out: IncomingTransfer[] = [];

    for (const { pubkey } of accounts?.value ?? []) {
      const signatures = await this.rpc<
        Array<{ signature: string; err: unknown; blockTime?: number | null }>
      >('getSignaturesForAddress', [pubkey, { limit: SIGNATURE_WINDOW, commitment: 'finalized' }]);

      for (const sig of signatures ?? []) {
        if (sig.err) continue;
        if (sig.blockTime && sig.blockTime < sinceSeconds) continue;
        if (query.finalTxHashes.has(sig.signature)) continue;

        const transfer = await this.readTransfer(sig.signature, query);
        if (transfer) out.push(transfer);
      }
    }
    return out;
  }

  private async readTransfer(
    signature: string,
    query: WatchQuery,
  ): Promise<IncomingTransfer | null> {
    const tx = await this.rpc<{
      blockTime?: number | null;
      meta?: {
        err: unknown;
        preTokenBalances?: TokenBalance[];
        postTokenBalances?: TokenBalance[];
      };
    } | null>('getTransaction', [
      signature,
      { encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 0 },
    ]);
    if (!tx?.meta || tx.meta.err) return null;

    const pre = tx.meta.preTokenBalances ?? [];
    const post = tx.meta.postTokenBalances ?? [];
    const ours = (b: TokenBalance) =>
      b.mint === query.contractAddress && b.owner === query.receiver;

    let delta = 0n;
    for (const after of post.filter(ours)) {
      const before = pre.find((b) => b.accountIndex === after.accountIndex);
      delta += BigInt(after.uiTokenAmount.amount) - BigInt(before?.uiTokenAmount.amount ?? '0');
    }
    if (delta <= 0n) return null;

    // Whoever's balance of the mint went down is who paid.
    const payer = pre.find((before) => {
      if (before.mint !== query.contractAddress || before.owner === query.receiver) return false;
      const after = post.find((b) => b.accountIndex === before.accountIndex);
      return BigInt(after?.uiTokenAmount.amount ?? '0') < BigInt(before.uiTokenAmount.amount);
    });

    return {
      chain: this.chain,
      txHash: signature,
      token: query.token,
      from: payer?.owner ?? null,
      to: query.receiver,
      amountRaw: delta.toString(),
      decimals: query.decimals,
      confirmations: query.requiredConfirmations,
      isFinal: true,
      blockTime: tx.blockTime ? new Date(tx.blockTime * 1000) : null,
    };
  }
}
