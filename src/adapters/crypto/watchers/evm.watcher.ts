import { ChainId, CHAINS } from '../chains';
import { ChainWatcher, IncomingTransfer, WatchQuery, WatcherHttpError, fetchJson } from './types';

/** keccak256("Transfer(address,address,uint256)") */
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
/** Public RPCs refuse wider eth_getLogs ranges. */
const BLOCKS_PER_REQUEST = 5_000n;
/** Per poll, so a long outage is caught up over several polls rather than one burst. */
const MAX_REQUESTS_PER_POLL = 20;
/** However long ago the oldest open invoice was opened, never look further back than this on first sight. */
const MAX_FIRST_LOOKBACK_MS = 26 * 60 * 60 * 1000;

interface RpcLog {
  transactionHash: string;
  blockNumber: string;
  data: string;
  topics: string[];
  removed?: boolean;
}

/**
 * ERC-20 transfers into a wallet on any EVM network, straight from the chain.
 *
 * Reads `Transfer` events to our address from the token contract with
 * eth_getLogs — no indexer, no API key, the same code for Ethereum, BNB
 * Chain, Polygon, Arbitrum, Optimism, Base and Avalanche. How far it has read
 * is kept in the database, so a restart resumes rather than missing blocks.
 * Each poll also re-reads the last few confirmations' worth of blocks, which
 * is how a transfer already seen gets deeper until it is final.
 */
export class EvmWatcher implements ChainWatcher {
  constructor(
    readonly chain: ChainId,
    private readonly rpcUrl: string = CHAINS[chain].evm?.rpcUrl ?? '',
  ) {}

  private async rpc<T>(method: string, params: unknown[]): Promise<T> {
    const answer = await fetchJson<{ result?: T; error?: { message: string } }>(this.rpcUrl, {
      method: 'POST',
      body: { jsonrpc: '2.0', id: 1, method, params },
    });
    if (answer.error)
      throw new WatcherHttpError(`${this.chain} RPC ${method}: ${answer.error.message}`);
    return answer.result as T;
  }

  async incoming(query: WatchQuery): Promise<IncomingTransfer[]> {
    const info = CHAINS[this.chain].evm;
    if (!info || !this.rpcUrl) return [];

    const latest = BigInt(await this.rpc<string>('eth_blockNumber', []));
    const required = BigInt(query.requiredConfirmations);
    const stored = (await query.cursor?.get()) ?? null;

    let from: bigint;
    if (stored === null) {
      const lookbackMs = Math.min(Date.now() - query.since.getTime(), MAX_FIRST_LOOKBACK_MS);
      const blocks =
        BigInt(Math.ceil((Math.max(lookbackMs, 0) / info.blockTimeMs) * 1.2)) + required;
      from = latest > blocks ? latest - blocks : 0n;
    } else {
      // Resume, and re-read the unconfirmed tail so seen transfers deepen.
      const tail = latest > required * 2n ? latest - required * 2n : 0n;
      from = stored + 1n < tail ? stored + 1n : tail;
    }

    const topicTo = `0x${query.receiver.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`;
    const logs: RpcLog[] = [];
    let scannedTo = from - 1n;
    for (let i = 0; i < MAX_REQUESTS_PER_POLL && scannedTo < latest; i++) {
      const start = scannedTo + 1n;
      const end =
        start + BLOCKS_PER_REQUEST - 1n < latest ? start + BLOCKS_PER_REQUEST - 1n : latest;
      const chunk = await this.rpc<RpcLog[]>('eth_getLogs', [
        {
          fromBlock: `0x${start.toString(16)}`,
          toBlock: `0x${end.toString(16)}`,
          address: query.contractAddress,
          topics: [TRANSFER_TOPIC, null, topicTo],
        },
      ]);
      logs.push(...(chunk ?? []));
      scannedTo = end;
    }
    if (query.cursor && scannedTo >= from && (stored === null || scannedTo > stored)) {
      await query.cursor.set(scannedTo);
    }

    return logs
      .filter((log) => !log.removed && /^0x[0-9a-fA-F]+$/.test(log.data))
      .map((log) => {
        const block = BigInt(log.blockNumber);
        const confirmations = Number(latest - block + 1n);
        const fromTopic = log.topics?.[1];
        return {
          chain: this.chain,
          txHash: log.transactionHash.toLowerCase(),
          token: query.token,
          from: fromTopic ? `0x${fromTopic.slice(-40)}` : null,
          to: query.receiver,
          amountRaw: BigInt(log.data).toString(),
          decimals: query.decimals,
          confirmations,
          isFinal: confirmations >= query.requiredConfirmations,
          blockTime: null,
        };
      })
      .filter((t) => t.amountRaw !== '0');
  }
}
