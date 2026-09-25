import { ChainWatcher, IncomingTransfer, WatchQuery, fetchJson } from './types';

interface TronGridPage {
  success?: boolean;
  data?: Array<{
    transaction_id: string;
    token_info?: { address?: string; decimals?: number };
    block_timestamp?: number;
    from?: string;
    to?: string;
    type?: string;
    value?: string;
  }>;
}

/**
 * TRC-20 transfers into a wallet, from TronGrid.
 *
 * Asks for confirmed (solidified) transactions only, so everything returned is
 * final: TRON solidifies a block after 19 confirmations, about a minute.
 */
export class TronWatcher implements ChainWatcher {
  readonly chain = 'TRON' as const;

  constructor(
    private readonly apiKey?: string,
    private readonly baseUrl = 'https://api.trongrid.io',
  ) {}

  async incoming(query: WatchQuery): Promise<IncomingTransfer[]> {
    const params = new URLSearchParams({
      only_to: 'true',
      only_confirmed: 'true',
      contract_address: query.contractAddress,
      min_timestamp: String(query.since.getTime()),
      order_by: 'block_timestamp,desc',
      limit: '200',
    });
    const page = await fetchJson<TronGridPage>(
      `${this.baseUrl}/v1/accounts/${query.receiver}/transactions/trc20?${params}`,
      { headers: this.apiKey ? { 'TRON-PRO-API-KEY': this.apiKey } : {} },
    );

    return (page.data ?? [])
      .filter(
        (tx) =>
          tx.type === 'Transfer' &&
          tx.to === query.receiver &&
          tx.token_info?.address === query.contractAddress &&
          /^\d+$/.test(tx.value ?? ''),
      )
      .map((tx) => ({
        chain: this.chain,
        txHash: tx.transaction_id,
        token: query.token,
        from: tx.from ?? null,
        to: tx.to as string,
        amountRaw: tx.value as string,
        decimals: query.decimals,
        confirmations: query.requiredConfirmations,
        isFinal: true,
        blockTime: tx.block_timestamp ? new Date(tx.block_timestamp) : null,
      }));
  }
}
