import { TRANSFER_WITH_AUTHORIZATION_SELECTOR, DEFAULT_LIMITS } from './relayer';
import { usdcAddress } from './protocol';
import { CHAINS } from '../chains';

/**
 * The Turnkey policy for the relayer's API user, filled in: sign only USDC
 * `transferWithAuthorization` on Base, from the fee wallet, to our wallet, with
 * no ETH attached and the fee capped. `data[98..138]` is the call's `to`
 * argument — the recipient — without `0x`.
 */
export function turnkeyPolicy(input: {
  turnkeyUserId?: string;
  relayerAddress: string;
  wallet: string;
}) {
  const condition = [
    "activity.type == 'ACTIVITY_TYPE_SIGN_TRANSACTION_V2'",
    `wallet_account.address == '${input.relayerAddress.toLowerCase()}'`,
    `eth.tx.chain_id == ${CHAINS.BASE.evm!.chainId}`,
    `eth.tx.to == '${usdcAddress().toLowerCase()}'`,
    'eth.tx.value == 0',
    `eth.tx.max_fee_per_gas <= ${DEFAULT_LIMITS.maxFeePerGasWei}`,
    `eth.tx.data[0..10] == '${TRANSFER_WITH_AUTHORIZATION_SELECTOR}'`,
    `eth.tx.data[98..138] == '${input.wallet.toLowerCase().replace(/^0x/, '')}'`,
  ].join(' && ');
  return {
    policyName: 'billing-x402: settle USDC authorizations on Base',
    effect: 'EFFECT_ALLOW',
    consensus: `approvers.any(user, user.id == '${input.turnkeyUserId ?? '<billing-x402 user id>'}')`,
    condition,
  };
}
