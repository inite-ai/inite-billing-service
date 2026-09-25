import { TronWatcher } from '../src/adapters/crypto/watchers/tron.watcher';
import { TonWatcher } from '../src/adapters/crypto/watchers/ton.watcher';
import { EthWatcher } from '../src/adapters/crypto/watchers/eth.watcher';
import { SolWatcher } from '../src/adapters/crypto/watchers/sol.watcher';
import { CHAINS } from '../src/adapters/crypto/chains';

/**
 * Each watcher turns one chain API's answer into incoming transfers. The
 * shapes below are the ones those APIs actually return (captured from mainnet
 * calls), and each test pins what a watcher must refuse to count: transfers
 * to somebody else, of another token, aborted or failed.
 */
describe('chain watchers', () => {
  const since = new Date('2026-09-25T00:00:00Z');
  const fetchMock = jest.fn();
  const answer = (body: unknown, status = 200) =>
    Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

  beforeEach(() => {
    fetchMock.mockReset();
    (global as any).fetch = fetchMock;
  });

  describe('TRON (TronGrid)', () => {
    const receiver = 'TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32G';
    const usdt = CHAINS.TRON.tokens.USDT!;
    const query = {
      receiver,
      token: 'USDT',
      contractAddress: usdt.contractAddress,
      decimals: 6,
      requiredConfirmations: 19,
      since,
      finalTxHashes: new Set<string>(),
    };

    it('reads confirmed incoming USDT transfers as final', async () => {
      fetchMock.mockReturnValue(
        answer({
          success: true,
          data: [
            {
              transaction_id: 'aa11',
              token_info: { address: usdt.contractAddress, decimals: 6 },
              block_timestamp: since.getTime() + 1000,
              from: 'TSender',
              to: receiver,
              type: 'Transfer',
              value: '10000137',
            },
            // Somebody else's transfer, and a token that only looks like USDT.
            {
              transaction_id: 'bb',
              token_info: { address: usdt.contractAddress },
              to: 'TOther',
              type: 'Transfer',
              value: '1',
            },
            {
              transaction_id: 'cc',
              token_info: { address: 'TFake' },
              to: receiver,
              type: 'Transfer',
              value: '1',
            },
          ],
        }),
      );

      const transfers = await new TronWatcher('key-1').incoming(query);

      expect(transfers).toEqual([
        expect.objectContaining({
          txHash: 'aa11',
          amountRaw: '10000137',
          isFinal: true,
          from: 'TSender',
        }),
      ]);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toContain(`/v1/accounts/${receiver}/transactions/trc20?`);
      expect(url).toContain('only_confirmed=true');
      expect(url).toContain('only_to=true');
      expect(init.headers['TRON-PRO-API-KEY']).toBe('key-1');
    });

    it('treats an API failure as an error, not as "no payments"', async () => {
      fetchMock.mockReturnValue(answer({}, 429));
      await expect(new TronWatcher().incoming(query)).rejects.toThrow('429');
    });
  });

  describe('TON (Toncenter v3)', () => {
    const receiver = 'EQDwB8YlfqX_bYO4cGGSkIJYUcgqlij6fhuEwEAhLAppLbEV';
    const receiverRaw = '0:F007C6257EA5FF6D83B870619290825851C82A9628FA7E1B84C040212C0A692D';
    const master = CHAINS.TON.tokens.USDT!;
    const masterRaw = '0:B113A994B5024A16719F69139328EB759596C38A25F59028B146FECDC3621DFE';
    const query = {
      receiver,
      token: 'USDT',
      contractAddress: master.contractAddress,
      decimals: 6,
      requiredConfirmations: 1,
      since,
      finalTxHashes: new Set<string>(),
    };

    it('reads jetton transfers in raw form and reports the hash in hex', async () => {
      fetchMock.mockReturnValue(
        answer({
          jetton_transfers: [
            {
              source: '0:4C53',
              destination: receiverRaw,
              amount: '500000',
              jetton_master: masterRaw,
              transaction_hash: 'dxkLr0G4qzoOgNFDVtVehCC/ALQZEk7+4JXFdzCoTAc=',
              transaction_now: 1790361609,
              transaction_aborted: false,
            },
            {
              destination: receiverRaw,
              amount: '1',
              jetton_master: masterRaw,
              transaction_hash: 'AA==',
              transaction_aborted: true,
            },
          ],
        }),
      );

      const transfers = await new TonWatcher().incoming(query);

      expect(transfers).toHaveLength(1);
      expect(transfers[0]).toMatchObject({
        amountRaw: '500000',
        to: receiverRaw,
        isFinal: true,
        txHash: Buffer.from('dxkLr0G4qzoOgNFDVtVehCC/ALQZEk7+4JXFdzCoTAc=', 'base64').toString(
          'hex',
        ),
      });
      expect(fetchMock.mock.calls[0][0]).toContain(
        `owner_address=${encodeURIComponent(receiverRaw)}`,
      );
    });
  });

  describe('Ethereum (Etherscan v2)', () => {
    const receiver = '0x1111111111111111111111111111111111111111';
    const usdc = CHAINS.ETH.tokens.USDC!;
    const query = {
      receiver,
      token: 'USDC',
      contractAddress: usdc.contractAddress,
      decimals: 6,
      requiredConfirmations: 12,
      since,
      finalTxHashes: new Set<string>(),
    };
    const tx = (o: Record<string, string>) => ({
      hash: '0xAB',
      from: '0xsender',
      to: receiver.toUpperCase().replace('0X', '0x'),
      value: '10000137',
      contractAddress: usdc.contractAddress.toLowerCase(),
      confirmations: '3',
      timeStamp: String(since.getTime() / 1000 + 60),
      ...o,
    });

    it('reports depth, and final only past the required confirmations', async () => {
      fetchMock.mockReturnValue(
        answer({
          status: '1',
          message: 'OK',
          result: [tx({}), tx({ hash: '0xCD', confirmations: '40' })],
        }),
      );
      const transfers = await new EthWatcher('k').incoming(query);
      expect(transfers.map((t) => [t.txHash, t.confirmations, t.isFinal])).toEqual([
        ['0xab', 3, false],
        ['0xcd', 40, true],
      ]);
    });

    it('treats "no transactions" as an empty wallet and a bad key as an error', async () => {
      fetchMock.mockReturnValueOnce(
        answer({ status: '0', message: 'No transactions found', result: [] }),
      );
      await expect(new EthWatcher('k').incoming(query)).resolves.toEqual([]);

      fetchMock.mockReturnValueOnce(
        answer({ status: '0', message: 'NOTOK', result: 'Invalid API Key' }),
      );
      await expect(new EthWatcher('k').incoming(query)).rejects.toThrow('Invalid API Key');
    });

    it('ignores transfers from before the invoice was opened', async () => {
      fetchMock.mockReturnValue(
        answer({
          status: '1',
          message: 'OK',
          result: [tx({ timeStamp: String(since.getTime() / 1000 - 3600) })],
        }),
      );
      await expect(new EthWatcher('k').incoming(query)).resolves.toEqual([]);
    });
  });

  describe('Solana (JSON-RPC)', () => {
    const receiver = '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1';
    const mint = CHAINS.SOL.tokens.USDC!.contractAddress;
    const query = {
      receiver,
      token: 'USDC',
      contractAddress: mint,
      decimals: 6,
      requiredConfirmations: 1,
      since,
      finalTxHashes: new Set<string>(['already-final']),
    };
    const bal = (accountIndex: number, owner: string, amount: string) => ({
      accountIndex,
      mint,
      owner,
      uiTokenAmount: { amount, decimals: 6 },
    });

    it('takes the change in the wallet’s token balance, and who paid it', async () => {
      const blockTime = since.getTime() / 1000 + 10;
      fetchMock.mockImplementation((_url: string, init: any) => {
        const { method } = JSON.parse(init.body);
        if (method === 'getTokenAccountsByOwner')
          return answer({ result: { value: [{ pubkey: 'ata' }] } });
        if (method === 'getSignaturesForAddress') {
          return answer({
            result: [
              { signature: 'sig-1', err: null, blockTime },
              { signature: 'failed', err: { InstructionError: [] }, blockTime },
              { signature: 'already-final', err: null, blockTime },
            ],
          });
        }
        return answer({
          result: {
            blockTime,
            meta: {
              err: null,
              preTokenBalances: [bal(1, receiver, '5000000'), bal(2, 'Payer', '20000000')],
              postTokenBalances: [bal(1, receiver, '15000137'), bal(2, 'Payer', '9999863')],
            },
          },
        });
      });

      const transfers = await new SolWatcher('https://rpc.example').incoming(query);

      expect(transfers).toEqual([
        expect.objectContaining({
          txHash: 'sig-1',
          amountRaw: '10000137',
          from: 'Payer',
          isFinal: true,
        }),
      ]);
      // Neither the failed transaction nor the one already recorded was fetched.
      const fetched = fetchMock.mock.calls
        .map(([, init]) => JSON.parse(init.body))
        .filter((b) => b.method === 'getTransaction')
        .map((b) => b.params[0]);
      expect(fetched).toEqual(['sig-1']);
    });

    it('counts nothing when the wallet’s balance went down', async () => {
      fetchMock.mockImplementation((_url: string, init: any) => {
        const { method } = JSON.parse(init.body);
        if (method === 'getTokenAccountsByOwner')
          return answer({ result: { value: [{ pubkey: 'ata' }] } });
        if (method === 'getSignaturesForAddress')
          return answer({ result: [{ signature: 'out', err: null }] });
        return answer({
          result: {
            meta: {
              err: null,
              preTokenBalances: [bal(1, receiver, '5000000')],
              postTokenBalances: [bal(1, receiver, '1000000')],
            },
          },
        });
      });
      await expect(new SolWatcher('https://rpc.example').incoming(query)).resolves.toEqual([]);
    });
  });
});
