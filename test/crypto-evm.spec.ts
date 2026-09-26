import { EvmWatcher } from '../src/adapters/crypto/watchers/evm.watcher';
import {
  CHAINS,
  EVM_CHAIN_IDS,
  isValidAddress,
  paymentUri,
  txExplorerUrl,
} from '../src/adapters/crypto/chains';
import { parseCryptoSettings, payable } from '../src/adapters/crypto/crypto-config';

/**
 * Stablecoins on every EVM network from one 0x wallet, watched through each
 * chain's RPC with no key. The token contracts here were checked on-chain
 * (symbol/decimals) when they were added.
 */
describe('EVM networks', () => {
  const WALLET = '0x1111111111111111111111111111111111111111';

  it('covers the major EVM networks with their chain ids', () => {
    expect(EVM_CHAIN_IDS).toEqual([
      'ETH',
      'BSC',
      'POLYGON',
      'ARBITRUM',
      'OPTIMISM',
      'BASE',
      'AVAX',
    ]);
    expect(EVM_CHAIN_IDS.map((c) => CHAINS[c].evm!.chainId)).toEqual([
      1, 56, 137, 42161, 10, 8453, 43114,
    ]);
    // BNB Chain's stablecoins carry 18 decimals — an amount scaled for 6 would be off by 10^12.
    expect(CHAINS.BSC.tokens.USDT!.decimals).toBe(18);
  });

  it('accepts one 0x address on every EVM network, and links the wallet to the right chain', () => {
    for (const chain of EVM_CHAIN_IDS) expect(isValidAddress(chain, WALLET)).toBe(true);
    expect(paymentUri('BASE', CHAINS.BASE.tokens.USDC!, WALLET, '5000137', '5.000137')).toBe(
      `ethereum:${CHAINS.BASE.tokens.USDC!.contractAddress}@8453/transfer?address=${WALLET}&uint256=5000137`,
    );
    expect(txExplorerUrl('BSC', '0xab')).toBe('https://bscscan.com/tx/0xab');
  });

  it('shares the EVM wallet across networks, with a network’s own address winning', () => {
    const settings = parseCryptoSettings({
      isActive: true,
      config: { wallets: { EVM: WALLET, BASE: '0x2222222222222222222222222222222222222222' } },
    })!;
    expect(settings.wallets.ETH).toBe(WALLET);
    expect(settings.wallets.AVAX).toBe(WALLET);
    expect(settings.wallets.BASE).toBe('0x2222222222222222222222222222222222222222');
    expect(settings.wallets.TRON).toBeUndefined();
    // No keys needed: every EVM network is payable from the wallet alone.
    expect(EVM_CHAIN_IDS.every((c) => payable(settings, c))).toBe(true);
  });

  describe('the log watcher', () => {
    const fetchMock = jest.fn();
    const calls: any[] = [];
    let cursorValue: bigint | null;
    const cursor = {
      get: jest.fn(async () => cursorValue),
      set: jest.fn(async (b: bigint) => {
        cursorValue = b;
      }),
    };
    const topicTo = `0x${'0'.repeat(24)}${WALLET.slice(2)}`;

    const log = (block: number, amount: bigint, tx = `0x${block.toString(16)}aa`) => ({
      transactionHash: tx,
      blockNumber: `0x${block.toString(16)}`,
      data: `0x${amount.toString(16).padStart(64, '0')}`,
      topics: [
        '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
        `0x${'0'.repeat(24)}${'ab'.repeat(20)}`,
        topicTo,
      ],
    });

    const chain = (latest: number, logs: any[]) =>
      fetchMock.mockImplementation(async (_url: string, init: any) => {
        const body = JSON.parse(init.body);
        calls.push(body);
        const result =
          body.method === 'eth_blockNumber'
            ? `0x${latest.toString(16)}`
            : logs.filter((l) => {
                const b = parseInt(l.blockNumber, 16);
                return (
                  b >= parseInt(body.params[0].fromBlock, 16) &&
                  b <= parseInt(body.params[0].toBlock, 16)
                );
              });
        return { ok: true, status: 200, json: async () => ({ result }) };
      });

    const query = () => ({
      receiver: WALLET,
      token: 'USDT',
      contractAddress: CHAINS.BSC.tokens.USDT!.contractAddress,
      decimals: 18,
      requiredConfirmations: 15,
      since: new Date(Date.now() - 10 * 60_000),
      finalTxHashes: new Set<string>(),
      cursor,
    });

    beforeEach(() => {
      fetchMock.mockReset();
      calls.length = 0;
      cursorValue = null;
      cursor.set.mockClear();
      (global as any).fetch = fetchMock;
    });

    it('reads transfers to our wallet with their depth, and remembers how far it read', async () => {
      chain(10_000, [
        log(9_990, 5_000137n * 10n ** 12n),
        log(9_500, 7n * 10n ** 18n),
        // Before the invoice was opened: outside the first look back.
        log(8_000, 9n * 10n ** 18n),
      ]);
      const transfers = await new EvmWatcher('BSC', 'https://rpc.example').incoming(query());

      const byBlock = Object.fromEntries(transfers.map((t) => [t.txHash, t]));
      expect(byBlock['0x2706aa']).toMatchObject({
        amountRaw: '5000137000000000000',
        confirmations: 11,
        isFinal: false,
      });
      expect(byBlock['0x1f40aa']).toBeUndefined();
      expect(byBlock['0x251caa']).toMatchObject({
        confirmations: 501,
        isFinal: true,
        from: `0x${'ab'.repeat(20)}`,
      });
      // Filtered by the Transfer event to our address, on the token contract.
      const getLogs = calls.find((c) => c.method === 'eth_getLogs').params[0];
      expect(getLogs.topics[2]).toBe(topicTo);
      expect(getLogs.address).toBe(CHAINS.BSC.tokens.USDT!.contractAddress);
      expect(cursorValue).toBe(10_000n);
    });

    it('resumes from where it stopped, re-reading only the unconfirmed tail', async () => {
      cursorValue = 9_990n;
      chain(10_000, []);
      await new EvmWatcher('BSC', 'https://rpc.example').incoming(query());
      const getLogs = calls.filter((c) => c.method === 'eth_getLogs').map((c) => c.params[0]);
      // min(cursor + 1, latest − 2 × 15 confirmations)
      expect(parseInt(getLogs[0].fromBlock, 16)).toBe(9_970);
    });

    it('never asks for more than 5 000 blocks at once', async () => {
      cursorValue = 0n;
      chain(12_000, []);
      await new EvmWatcher('BSC', 'https://rpc.example').incoming(query());
      for (const c of calls.filter((c) => c.method === 'eth_getLogs')) {
        const range = parseInt(c.params[0].toBlock, 16) - parseInt(c.params[0].fromBlock, 16) + 1;
        expect(range).toBeLessThanOrEqual(5_000);
      }
      expect(cursorValue).toBe(12_000n);
    });

    it('treats an RPC error as an error, not as an empty wallet', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ error: { message: 'limit exceeded' } }),
      });
      await expect(new EvmWatcher('BSC', 'https://rpc.example').incoming(query())).rejects.toThrow(
        'limit exceeded',
      );
      expect(cursor.set).not.toHaveBeenCalled();
    });
  });
});
