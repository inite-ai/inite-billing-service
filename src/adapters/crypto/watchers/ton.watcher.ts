import { tonToRaw } from '../chains';
import { ChainWatcher, IncomingTransfer, WatchQuery, fetchJson } from './types';

interface ToncenterPage {
  jetton_transfers?: Array<{
    source?: string | null;
    destination?: string;
    amount?: string;
    jetton_master?: string;
    transaction_hash?: string;
    transaction_now?: number;
    transaction_aborted?: boolean;
  }>;
}

/**
 * Jetton transfers into a wallet, from Toncenter's v3 index.
 *
 * The index serves committed transactions only, so what it returns is final.
 * Addresses come back in raw `0:HEX` form whatever form was asked with, so the
 * comparison is done in raw form too. The transaction hash is reported in
 * base64 and turned into the hex the explorers use.
 */
export class TonWatcher implements ChainWatcher {
  readonly chain = 'TON' as const;

  constructor(
    private readonly apiKey?: string,
    private readonly baseUrl = 'https://toncenter.com',
  ) {}

  async incoming(query: WatchQuery): Promise<IncomingTransfer[]> {
    const receiverRaw = tonToRaw(query.receiver);
    const masterRaw = tonToRaw(query.contractAddress);
    if (!receiverRaw || !masterRaw) return [];

    const params = new URLSearchParams({
      owner_address: receiverRaw,
      direction: 'in',
      jetton_master: query.contractAddress,
      start_utime: String(Math.floor(query.since.getTime() / 1000)),
      limit: '100',
      sort: 'desc',
    });
    const page = await fetchJson<ToncenterPage>(
      `${this.baseUrl}/api/v3/jetton/transfers?${params}`,
      {
        headers: this.apiKey ? { 'X-API-Key': this.apiKey } : {},
      },
    );

    const out: IncomingTransfer[] = [];
    for (const t of page.jetton_transfers ?? []) {
      if (t.transaction_aborted) continue;
      if (!t.destination || tonToRaw(t.destination) !== receiverRaw) continue;
      if (!t.jetton_master || tonToRaw(t.jetton_master) !== masterRaw) continue;
      if (!t.transaction_hash || !/^\d+$/.test(t.amount ?? '')) continue;
      out.push({
        chain: this.chain,
        txHash: Buffer.from(t.transaction_hash, 'base64').toString('hex'),
        token: query.token,
        from: t.source ?? null,
        to: receiverRaw,
        amountRaw: t.amount as string,
        decimals: query.decimals,
        confirmations: query.requiredConfirmations,
        isFinal: true,
        blockTime: t.transaction_now ? new Date(t.transaction_now * 1000) : null,
      });
    }
    return out;
  }
}
