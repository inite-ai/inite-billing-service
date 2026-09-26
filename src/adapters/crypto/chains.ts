import { createHash } from 'node:crypto';

export type ChainId =
  'TRON' | 'TON' | 'SOL' | 'ETH' | 'BSC' | 'POLYGON' | 'ARBITRUM' | 'OPTIMISM' | 'BASE' | 'AVAX';
export type TokenSymbol = 'USDT' | 'USDC';

export interface TokenInfo {
  /** Contract (ERC-20/TRC-20), mint (SPL) or jetton master (TON). */
  contractAddress: string;
  decimals: number;
}

export interface ChainInfo {
  id: ChainId;
  name: string;
  /** What a wallet calls the network — the thing a customer must pick right. */
  network: string;
  explorerUrl: string;
  /** Confirmations after which a transfer is treated as final. */
  confirmations: number;
  tokens: Partial<Record<TokenSymbol, TokenInfo>>;
  /** EVM networks share an address format, a wallet and a watcher. */
  evm?: {
    chainId: number;
    /** A public RPC that serves eth_getLogs over 5 000-block ranges without a key. */
    rpcUrl: string;
    /** Roughly — only used to size the first look back. */
    blockTimeMs: number;
  };
}

/**
 * The chains and tokens this rail accepts.
 *
 * Only what can actually be settled: USDC was dropped from TRON (Circle ended
 * it there in 2024) and there is no Circle-issued USDC on TON, so those pairs
 * are not offered rather than offered and then never recognised.
 */
export const CHAINS: Record<ChainId, ChainInfo> = {
  TRON: {
    id: 'TRON',
    name: 'TRON',
    network: 'TRC-20',
    explorerUrl: 'https://tronscan.org',
    confirmations: 19,
    tokens: {
      USDT: { contractAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', decimals: 6 },
    },
  },
  TON: {
    id: 'TON',
    name: 'TON',
    network: 'TON',
    explorerUrl: 'https://tonviewer.com',
    confirmations: 1,
    tokens: {
      USDT: { contractAddress: 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs', decimals: 6 },
    },
  },
  SOL: {
    id: 'SOL',
    name: 'Solana',
    network: 'SPL',
    explorerUrl: 'https://solscan.io',
    confirmations: 1,
    tokens: {
      USDT: { contractAddress: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6 },
      USDC: { contractAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
    },
  },
  // EVM networks. Every token contract below was checked on its chain
  // (symbol() and decimals() via RPC) — BNB Chain's stablecoins have 18
  // decimals, not 6, and USDT on Polygon and Arbitrum is now USDT0 at the
  // same address.
  ETH: {
    id: 'ETH',
    name: 'Ethereum',
    network: 'ERC-20',
    explorerUrl: 'https://etherscan.io',
    confirmations: 12,
    evm: { chainId: 1, rpcUrl: 'https://ethereum-rpc.publicnode.com', blockTimeMs: 12_000 },
    tokens: {
      USDT: { contractAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
      USDC: { contractAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
    },
  },
  BSC: {
    id: 'BSC',
    name: 'BNB Chain',
    network: 'BEP-20',
    explorerUrl: 'https://bscscan.com',
    confirmations: 15,
    evm: { chainId: 56, rpcUrl: 'https://bsc-rpc.publicnode.com', blockTimeMs: 750 },
    tokens: {
      USDT: { contractAddress: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
      USDC: { contractAddress: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
    },
  },
  POLYGON: {
    id: 'POLYGON',
    name: 'Polygon',
    network: 'Polygon PoS',
    explorerUrl: 'https://polygonscan.com',
    confirmations: 64,
    evm: { chainId: 137, rpcUrl: 'https://polygon-bor-rpc.publicnode.com', blockTimeMs: 2_000 },
    tokens: {
      USDT: { contractAddress: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6 },
      USDC: { contractAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6 },
    },
  },
  ARBITRUM: {
    id: 'ARBITRUM',
    name: 'Arbitrum One',
    network: 'Arbitrum',
    explorerUrl: 'https://arbiscan.io',
    confirmations: 20,
    evm: { chainId: 42161, rpcUrl: 'https://arb1.arbitrum.io/rpc', blockTimeMs: 250 },
    tokens: {
      USDT: { contractAddress: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6 },
      USDC: { contractAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 },
    },
  },
  OPTIMISM: {
    id: 'OPTIMISM',
    name: 'Optimism',
    network: 'OP Mainnet',
    explorerUrl: 'https://optimistic.etherscan.io',
    confirmations: 20,
    evm: { chainId: 10, rpcUrl: 'https://optimism-rpc.publicnode.com', blockTimeMs: 2_000 },
    tokens: {
      USDT: { contractAddress: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', decimals: 6 },
      USDC: { contractAddress: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', decimals: 6 },
    },
  },
  BASE: {
    id: 'BASE',
    name: 'Base',
    network: 'Base',
    explorerUrl: 'https://basescan.org',
    confirmations: 20,
    evm: { chainId: 8453, rpcUrl: 'https://base-rpc.publicnode.com', blockTimeMs: 2_000 },
    tokens: {
      USDC: { contractAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
      USDT: { contractAddress: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', decimals: 6 },
    },
  },
  AVAX: {
    id: 'AVAX',
    name: 'Avalanche',
    network: 'Avalanche C-Chain',
    explorerUrl: 'https://snowtrace.io',
    confirmations: 12,
    evm: {
      chainId: 43114,
      rpcUrl: 'https://avalanche-c-chain-rpc.publicnode.com',
      blockTimeMs: 2_000,
    },
    tokens: {
      USDT: { contractAddress: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', decimals: 6 },
      USDC: { contractAddress: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', decimals: 6 },
    },
  },
};

export const CHAIN_IDS = Object.keys(CHAINS) as ChainId[];

export const EVM_CHAIN_IDS = CHAIN_IDS.filter((id) => !!CHAINS[id].evm);

export function isEvm(chain: ChainId): boolean {
  return !!CHAINS[chain]?.evm;
}

/** The settings key for the one wallet every EVM network shares. */
export const EVM_WALLET_KEY = 'EVM';

/** Stablecoins are priced 1:1 against the dollar, so only dollar prices can be sold for them. */
export const STABLECOIN_CURRENCIES = new Set(['USD', 'USDT', 'USDC']);

export function isChainId(value: unknown): value is ChainId {
  return typeof value === 'string' && value in CHAINS;
}

// ─── Address handling ─────────────────────────────────────────

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Decode(input: string): Buffer | null {
  if (!input) return null;
  let value = 0n;
  for (const char of input) {
    const digit = BASE58.indexOf(char);
    if (digit < 0) return null;
    value = value * 58n + BigInt(digit);
  }
  let hex = value.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const body = value === 0n ? Buffer.alloc(0) : Buffer.from(hex, 'hex');
  let leadingZeros = 0;
  while (leadingZeros < input.length && input[leadingZeros] === '1') leadingZeros++;
  return Buffer.concat([Buffer.alloc(leadingZeros), body]);
}

function sha256(data: Buffer): Buffer {
  return createHash('sha256').update(data).digest();
}

function crc16Xmodem(data: Buffer): number {
  let crc = 0;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

/** A TON address in raw `workchain:HEX` form, from either raw or user-friendly input. */
export function tonToRaw(address: string): string | null {
  const trimmed = address.trim();
  const raw = trimmed.match(/^(-?\d+):([0-9a-fA-F]{64})$/);
  if (raw) return `${Number(raw[1])}:${raw[2].toUpperCase()}`;

  if (!/^[A-Za-z0-9_\-+/]{48}$/.test(trimmed)) return null;
  const bytes = Buffer.from(trimmed.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (bytes.length !== 36) return null;
  const expected = bytes.readUInt16BE(34);
  if (crc16Xmodem(bytes.subarray(0, 34)) !== expected) return null;
  const workchain = bytes.readInt8(1);
  return `${workchain}:${bytes.subarray(2, 34).toString('hex').toUpperCase()}`;
}

/**
 * Is this a receiving address on that chain?
 *
 * Checked when an admin saves a wallet, because a typo here is not an error
 * anyone sees — it is customers paying into an address nobody controls.
 */
export function isValidAddress(chain: ChainId, address: string): boolean {
  const value = address.trim();
  switch (chain) {
    case 'ETH':
    case 'BSC':
    case 'POLYGON':
    case 'ARBITRUM':
    case 'OPTIMISM':
    case 'BASE':
    case 'AVAX':
      return /^0x[0-9a-fA-F]{40}$/.test(value);
    case 'TRON': {
      if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value)) return false;
      const bytes = base58Decode(value);
      if (!bytes || bytes.length !== 25 || bytes[0] !== 0x41) return false;
      const checksum = sha256(sha256(bytes.subarray(0, 21))).subarray(0, 4);
      return checksum.equals(bytes.subarray(21));
    }
    case 'SOL': {
      const bytes = base58Decode(value);
      return !!bytes && bytes.length === 32 && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
    }
    case 'TON':
      return tonToRaw(value) !== null;
    default:
      return false;
  }
}

/**
 * The form two addresses on a chain are compared in.
 *
 * EVM addresses are case-insensitive (the case is only a checksum); TON has
 * several spellings of one address and indexers report the raw one; TRON and
 * Solana are base58 and compared exactly.
 */
export function receiverKey(chain: ChainId, address: string): string {
  const value = address.trim();
  if (isEvm(chain)) return value.toLowerCase();
  if (chain === 'TON') return tonToRaw(value) ?? value;
  return value;
}

// ─── What the customer is shown ──────────────────────────────

/**
 * A URI a wallet can open with the transfer filled in, where the chain has a
 * standard for one. TRON has none that wallets agree on, so there the QR code
 * carries the address and the amount is typed.
 */
export function paymentUri(
  chain: ChainId,
  token: TokenInfo,
  to: string,
  amountRaw: string,
  amountDecimal: string,
): string {
  const evm = CHAINS[chain]?.evm;
  if (evm) {
    // EIP-681: a call to the token contract's transfer(address,uint256), on this chain.
    return `ethereum:${token.contractAddress}@${evm.chainId}/transfer?address=${to}&uint256=${amountRaw}`;
  }
  switch (chain) {
    case 'SOL':
      // Solana Pay.
      return `solana:${to}?amount=${amountDecimal}&spl-token=${token.contractAddress}`;
    case 'TON':
      return `ton://transfer/${to}?jetton=${token.contractAddress}&amount=${amountRaw}`;
    default:
      return to;
  }
}

export function txExplorerUrl(chain: ChainId, txHash: string): string {
  const base = CHAINS[chain].explorerUrl;
  switch (chain) {
    case 'TRON':
      return `${base}/#/transaction/${txHash}`;
    case 'TON':
      return `${base}/transaction/${txHash}`;
    default:
      return `${base}/tx/${txHash}`;
  }
}
