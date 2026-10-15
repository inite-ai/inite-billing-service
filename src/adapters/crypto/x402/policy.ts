import { TRANSFER_WITH_AUTHORIZATION_SELECTOR, DEFAULT_LIMITS } from './relayer';
import { usdcAddress } from './protocol';
import { CHAINS } from '../chains';

const USER_PLACEHOLDER = '<billing user id>';

/**
 * The Turnkey policy that lets billing's API user relay: sign only USDC
 * `transferWithAuthorization` on Base, from the fee wallet, with no ETH
 * attached and the fee capped.
 *
 * The recipient is not pinned. The relayer carries x402 payments to our
 * wallet and withdrawals from people's INITE wallets to wherever they send
 * them; either way the recipient and the amount are fixed by the payer's own
 * signature, which the relayer cannot alter or forge. So a stolen key can do
 * no more than anyone who sees a signed authorization can: put it on chain.
 * What it costs is our fees, capped per transaction and per day.
 */
export function turnkeyPolicy(input: { turnkeyUserId?: string; relayerAddress: string }) {
  const condition = [
    "activity.type == 'ACTIVITY_TYPE_SIGN_TRANSACTION_V2'",
    `wallet_account.address == '${input.relayerAddress.toLowerCase()}'`,
    `eth.tx.chain_id == ${CHAINS.BASE.evm!.chainId}`,
    `eth.tx.to == '${usdcAddress().toLowerCase()}'`,
    'eth.tx.value == 0',
    `eth.tx.max_fee_per_gas <= ${DEFAULT_LIMITS.maxFeePerGasWei}`,
    `eth.tx.data[0..10] == '${TRANSFER_WITH_AUTHORIZATION_SELECTOR}'`,
  ].join(' && ');
  return {
    policyName: 'billing: relay USDC authorizations on Base',
    effect: 'EFFECT_ALLOW',
    consensus: consensus(input.turnkeyUserId),
    condition,
  };
}

/**
 * The Turnkey policy that lets billing's API user open INITE wallets: create
 * a sub-organization, and nothing else. The person's passkey is the new
 * sub-organization's only root user; Turnkey keeps sub-organizations apart, so
 * this user can sign nothing inside one.
 */
export function walletsPolicy(input: { turnkeyUserId?: string }) {
  return {
    policyName: 'billing: open INITE wallets',
    effect: 'EFFECT_ALLOW',
    consensus: consensus(input.turnkeyUserId),
    condition: "activity.type == 'ACTIVITY_TYPE_CREATE_SUB_ORGANIZATION_V8'",
  };
}

function consensus(turnkeyUserId?: string) {
  return `approvers.any(user, user.id == '${turnkeyUserId ?? USER_PLACEHOLDER}')`;
}
