import { ChainWatcher, IncomingTransfer, WatchQuery, WatcherHttpError, fetchJson } from './types';

interface EtherscanAnswer {
  status: string;
  message: string;
  result:
    | string
    | Array<{
        hash: string;
        from: string;
        to: string;
        value: string;
        contractAddress: string;
        confirmations: string;
        timeStamp: string;
      }>;
}

/**
 * ERC-20 transfers into a wallet, from the Etherscan v2 API.
 *
 * Unlike the other chains this sees transactions before they are final and
 * reports how deep each one is, so an invoice moves to "confirming" as soon as
 * its transfer is mined and to paid at the configured depth.
 */
export class EthWatcher implements ChainWatcher {
  readonly chain = 'ETH' as const;

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = 'https://api.etherscan.io',
  ) {}

  async incoming(query: WatchQuery): Promise<IncomingTransfer[]> {
    const params = new URLSearchParams({
      chainid: '1',
      module: 'account',
      action: 'tokentx',
      contractaddress: query.contractAddress,
      address: query.receiver,
      page: '1',
      offset: '100',
      sort: 'desc',
      apikey: this.apiKey,
    });
    const answer = await fetchJson<EtherscanAnswer>(`${this.baseUrl}/v2/api?${params}`);

    if (answer.status !== '1') {
      // "No transactions found" is an empty wallet, not a failure.
      if (Array.isArray(answer.result) || /no transactions/i.test(answer.message)) return [];
      throw new WatcherHttpError(`Etherscan: ${String(answer.result || answer.message)}`);
    }
    if (!Array.isArray(answer.result)) return [];

    const receiver = query.receiver.toLowerCase();
    const contract = query.contractAddress.toLowerCase();
    const sinceSeconds = Math.floor(query.since.getTime() / 1000);

    return answer.result
      .filter(
        (tx) =>
          tx.to?.toLowerCase() === receiver &&
          tx.contractAddress?.toLowerCase() === contract &&
          Number(tx.timeStamp) >= sinceSeconds &&
          /^\d+$/.test(tx.value),
      )
      .map((tx) => {
        const confirmations = Number(tx.confirmations) || 0;
        return {
          chain: this.chain,
          txHash: tx.hash.toLowerCase(),
          token: query.token,
          from: tx.from,
          to: tx.to,
          amountRaw: tx.value,
          decimals: query.decimals,
          confirmations,
          isFinal: confirmations >= query.requiredConfirmations,
          blockTime: new Date(Number(tx.timeStamp) * 1000),
        };
      });
  }
}
