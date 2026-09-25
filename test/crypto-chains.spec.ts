import {
  isValidAddress,
  paymentUri,
  receiverKey,
  tonToRaw,
  txExplorerUrl,
  CHAINS,
} from '../src/adapters/crypto/chains';
import { formatUnits, parseRawAmount } from '../src/adapters/crypto/amount.util';

/**
 * A wallet address saved with a typo is not an error anyone sees: customers
 * pay into it and the money is gone. These pin the checks that stop that at
 * the settings form, against real mainnet addresses.
 */
describe('crypto addresses', () => {
  it('accepts real addresses on each chain', () => {
    expect(isValidAddress('TRON', 'TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32G')).toBe(true);
    expect(isValidAddress('ETH', '0xdAC17F958D2ee523a2206206994597C13D831ec7')).toBe(true);
    expect(isValidAddress('SOL', '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1')).toBe(true);
    expect(isValidAddress('TON', 'EQDwB8YlfqX_bYO4cGGSkIJYUcgqlij6fhuEwEAhLAppLbEV')).toBe(true);
    expect(
      isValidAddress('TON', '0:F007C6257EA5FF6D83B870619290825851C82A9628FA7E1B84C040212C0A692D'),
    ).toBe(true);
  });

  it('refuses a TRON address with one character changed (checksum)', () => {
    expect(isValidAddress('TRON', 'TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32H')).toBe(false);
  });

  it('refuses a TON address with one character changed (crc16)', () => {
    expect(isValidAddress('TON', 'EQDwB8YlfqX_bYO4cGGSkIJYUcgqlij6fhuEwEAhLAppLbEW')).toBe(false);
  });

  it('refuses an address from the wrong chain', () => {
    expect(isValidAddress('TRON', '0xdAC17F958D2ee523a2206206994597C13D831ec7')).toBe(false);
    expect(isValidAddress('ETH', 'TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32G')).toBe(false);
    expect(isValidAddress('SOL', 'TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32G')).toBe(false);
  });

  it('reads a user-friendly TON address in the raw form indexers report', () => {
    expect(tonToRaw('EQDwB8YlfqX_bYO4cGGSkIJYUcgqlij6fhuEwEAhLAppLbEV')).toBe(
      '0:F007C6257EA5FF6D83B870619290825851C82A9628FA7E1B84C040212C0A692D',
    );
  });

  it('compares addresses the way each chain means them', () => {
    expect(receiverKey('ETH', '0xABCdef0000000000000000000000000000000001')).toBe(
      '0xabcdef0000000000000000000000000000000001',
    );
    expect(receiverKey('TON', 'EQDwB8YlfqX_bYO4cGGSkIJYUcgqlij6fhuEwEAhLAppLbEV')).toBe(
      receiverKey('TON', '0:f007c6257ea5ff6d83b870619290825851c82a9628fa7e1b84c040212c0a692d'),
    );
    expect(receiverKey('TRON', 'TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32G')).toBe(
      'TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32G',
    );
  });

  it('builds a wallet link per chain standard, and only the address on TRON', () => {
    const usdt = (chain: 'ETH' | 'SOL' | 'TON' | 'TRON') => CHAINS[chain].tokens.USDT!;
    expect(paymentUri('ETH', usdt('ETH'), '0xabc', '10000137', '10.000137')).toBe(
      'ethereum:0xdAC17F958D2ee523a2206206994597C13D831ec7@1/transfer?address=0xabc&uint256=10000137',
    );
    expect(paymentUri('SOL', usdt('SOL'), 'Recv', '10000137', '10.000137')).toBe(
      'solana:Recv?amount=10.000137&spl-token=Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    );
    expect(paymentUri('TON', usdt('TON'), 'EQx', '10000137', '10.000137')).toContain(
      'ton://transfer/EQx?jetton=',
    );
    expect(paymentUri('TRON', usdt('TRON'), 'Tabc', '10000137', '10.000137')).toBe('Tabc');
  });

  it('links a transaction on each explorer', () => {
    expect(txExplorerUrl('TRON', 'ab')).toBe('https://tronscan.org/#/transaction/ab');
    expect(txExplorerUrl('ETH', '0xab')).toBe('https://etherscan.io/tx/0xab');
  });

  it('does not offer the pairs nobody issues any more', () => {
    expect(CHAINS.TRON.tokens.USDC).toBeUndefined();
    expect(CHAINS.TON.tokens.USDC).toBeUndefined();
  });
});

describe('crypto amounts', () => {
  it('formats an on-chain amount exactly, without trailing zeros', () => {
    expect(formatUnits('10000137', 6)).toBe('10.000137');
    expect(formatUnits('10000000', 6)).toBe('10');
    expect(formatUnits('137', 6)).toBe('0.000137');
    expect(formatUnits('0', 6)).toBe('0');
  });

  it('reads an amount given either in smallest units or as a decimal', () => {
    expect(parseRawAmount('10000137', 6)).toBe(10000137n);
    expect(parseRawAmount('10.000137', 6)).toBe(10000137n);
    expect(parseRawAmount('10.0', 6)).toBe(10000000n);
  });

  it('refuses an amount finer than the token can hold, rather than rounding it', () => {
    expect(parseRawAmount('1.0000001', 6)).toBeNull();
    expect(parseRawAmount('abc', 6)).toBeNull();
    expect(parseRawAmount(undefined, 6)).toBeNull();
  });
});
