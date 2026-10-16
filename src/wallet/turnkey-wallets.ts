import { ApiKeyStamper } from '@turnkey/api-key-stamper';
import type { TurnkeyApiTypes } from '@turnkey/http';
import { getAddress } from 'viem';
import type { RelayerKey } from '../adapters/crypto/x402/relayer-key';

export const TURNKEY_API = 'https://api.turnkey.com';

/** The passkey made in the browser for a new wallet, as WebAuthn returned it (base64url). */
export interface PasskeyAttestation {
  /** base64url of the challenge the browser signed. */
  challenge: string;
  credentialId: string;
  clientDataJson: string;
  attestationObject: string;
  transports: string[];
}

export interface OpenedWallet {
  subOrganizationId: string;
  turnkeyWalletId: string;
  address: `0x${string}`;
}

/** What Turnkey answered a passkey-stamped request with. */
export class TurnkeyRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const TRANSPORTS: Record<string, string> = {
  internal: 'AUTHENTICATOR_TRANSPORT_INTERNAL',
  hybrid: 'AUTHENTICATOR_TRANSPORT_HYBRID',
  usb: 'AUTHENTICATOR_TRANSPORT_USB',
  nfc: 'AUTHENTICATOR_TRANSPORT_NFC',
  ble: 'AUTHENTICATOR_TRANSPORT_BLE',
};

/**
 * Billing's two kinds of request to Turnkey for INITE wallets.
 *
 * Opening a wallet is billing's own request, stamped with billing's key in
 * our organization: a sub-organization whose only root user is the person's
 * new passkey, with one Ethereum account. The policy on billing's API user
 * allows nothing else (walletsPolicy).
 *
 * Everything inside the wallet is the person's request: a body billing
 * prepared, stamped by their passkey in the browser, which billing passes on
 * unchanged. The stamp covers the exact bytes, so billing cannot alter what
 * the person approved, and its own key has no standing in the sub-organization.
 */
export class TurnkeyWallets {
  constructor(private readonly baseUrl: string = TURNKEY_API) {}

  async open(
    organizationId: string,
    key: RelayerKey,
    input: { name: string } & ({ passkey: PasskeyAttestation } | { ownerKey: string }),
  ): Promise<OpenedWallet> {
    // The owner: a person's passkey, or an agent's own P-256 key (compressed
    // hex) for a wallet the agent alone controls.
    const owner =
      'ownerKey' in input
        ? {
            userName: 'Agent',
            apiKeys: [
              {
                apiKeyName: 'Agent key',
                publicKey: input.ownerKey,
                curveType: 'API_KEY_CURVE_P256' as const,
              },
            ],
            oauthProviders: [],
            authenticators: [],
          }
        : {
            userName: 'Owner',
            apiKeys: [],
            oauthProviders: [],
            authenticators: [
              {
                authenticatorName: 'INITE wallet passkey',
                challenge: input.passkey.challenge,
                attestation: {
                  credentialId: input.passkey.credentialId,
                  clientDataJson: input.passkey.clientDataJson,
                  attestationObject: input.passkey.attestationObject,
                  transports: input.passkey.transports
                    .map((t) => TRANSPORTS[t])
                    .filter(Boolean) as TurnkeyApiTypes['v1AuthenticatorTransport'][],
                },
              },
            ],
          };
    const request: TurnkeyApiTypes['v1CreateSubOrganizationRequest'] = {
      type: 'ACTIVITY_TYPE_CREATE_SUB_ORGANIZATION_V8',
      organizationId,
      timestampMs: String(Date.now()),
      parameters: {
        subOrganizationName: input.name,
        rootQuorumThreshold: 1,
        rootUsers: [owner],
        wallet: {
          walletName: 'INITE wallet',
          accounts: [
            {
              curve: 'CURVE_SECP256K1',
              pathFormat: 'PATH_FORMAT_BIP32',
              path: "m/44'/60'/0'/0/0",
              addressFormat: 'ADDRESS_FORMAT_ETHEREUM',
            },
          ],
        },
        // No way in but the owner's passkey or key: no email or SMS sign-in Turnkey would
        // run on our organization's behalf.
        disableEmailRecovery: true,
        disableEmailAuth: true,
        disableSmsAuth: true,
        disableOtpEmailAuth: true,
      },
    };
    const body = JSON.stringify(request);
    const stamp = await new ApiKeyStamper({
      apiPublicKey: key.publicKey,
      apiPrivateKey: key.privateKey,
    }).stamp(body);
    const result = await this.post('/public/v1/submit/create_sub_organization', body, {
      [stamp.stampHeaderName]: stamp.stampHeaderValue,
    });
    const opened = result.createSubOrganizationResultV8;
    const address = opened?.wallet?.addresses?.[0];
    if (!opened?.subOrganizationId || !opened.wallet?.walletId || !address) {
      throw new TurnkeyRequestError('Turnkey opened no wallet', 502);
    }
    return {
      subOrganizationId: opened.subOrganizationId,
      turnkeyWalletId: opened.wallet.walletId,
      address: getAddress(address),
    };
  }

  /**
   * Submit a request the person's passkey stamped. `body` must be the exact
   * string that was stamped. Returns the completed activity's result.
   */
  /** Submit a request stamped with an API key billing holds (an agent's, in its user's sub-organization). */
  async submitWithKey(path: string, body: string, key: RelayerKey): Promise<Record<string, any>> {
    const stamp = await new ApiKeyStamper({
      apiPublicKey: key.publicKey,
      apiPrivateKey: key.privateKey,
    }).stamp(body);
    return this.post(path, body, { [stamp.stampHeaderName]: stamp.stampHeaderValue });
  }

  submitStamped(path: string, body: string, stamp: string): Promise<Record<string, any>> {
    return this.post(path, body, { 'X-Stamp-WebAuthn': stamp });
  }

  /** Submit a request an agent stamped with its own key (Turnkey's X-Stamp value). */
  submitKeyStamped(path: string, body: string, stamp: string): Promise<Record<string, any>> {
    return this.post(path, body, { 'X-Stamp': stamp });
  }

  /** POST a stamped body to Turnkey; the completed activity's result. */
  private async post(
    path: string,
    body: string,
    stamp: Record<string, string>,
  ): Promise<Record<string, any>> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...stamp },
      body,
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      // not JSON
    }
    if (!response.ok) {
      throw new TurnkeyRequestError(
        `Turnkey ${response.status}: ${json?.message ?? text.slice(0, 300)}`,
        response.status,
      );
    }
    const activity = json?.activity;
    if (activity?.status !== 'ACTIVITY_STATUS_COMPLETED') {
      throw new TurnkeyRequestError(
        `Turnkey did not complete the request: ${activity?.status ?? 'no activity'}`,
        502,
      );
    }
    return activity.result ?? {};
  }
}
