import { ChainId } from '../chains';
import { CryptoSettings, watchable } from '../crypto-config';
import { EthWatcher } from './eth.watcher';
import { SolWatcher } from './sol.watcher';
import { TonWatcher } from './ton.watcher';
import { TronWatcher } from './tron.watcher';
import { ChainWatcher } from './types';

export * from './types';

/**
 * The watcher for a chain under these settings, or null when it cannot watch it.
 *
 * `anyWallet` watches even when the chain's wallet has since been removed from
 * the settings: invoices already issued still point at the old address, and a
 * customer paying one of them is still paying us.
 */
export function watcherFor(
  chain: ChainId,
  settings: CryptoSettings,
  opts: { anyWallet?: boolean } = {},
): ChainWatcher | null {
  if (!opts.anyWallet && !watchable(settings, chain)) return null;
  if (chain === 'ETH' && !settings.etherscanApiKey) return null;
  switch (chain) {
    case 'TRON':
      return new TronWatcher(settings.trongridApiKey);
    case 'TON':
      return new TonWatcher(settings.toncenterApiKey);
    case 'ETH':
      return new EthWatcher(settings.etherscanApiKey as string);
    case 'SOL':
      return new SolWatcher(settings.solanaRpcUrl);
    default:
      return null;
  }
}
