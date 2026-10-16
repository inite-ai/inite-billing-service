import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type Wallet, type WalletAgent } from '@prisma/client';
import { formatUnits } from 'viem';
import { PrismaService } from '../common/services/prisma.service';
import { newTurnkeyApiKey } from '../adapters/crypto/x402/relayer-key';
import { loadCryptoSettings } from '../adapters/crypto/crypto-config';
import {
  AgentLimits,
  CHECKOUT_MAX_PAYMENT,
  agentPolicy,
  checkLimits,
  checkoutPolicy,
} from './agent-limits';
import { TurnkeyRequestError, TurnkeyWallets } from './turnkey-wallets';
import { primaryIssuer } from '../auth/token-contract';

const CREATE_USERS_PATH = '/public/v1/submit/create_users';
const CREATE_POLICY_PATH = '/public/v1/submit/create_policy';
/** The record of a wallet's "INITE checkout" user among its agents. */
export const CHECKOUT_AGENT_DID = 'inite:checkout';
/** How long an agent's DID document is trusted before it is fetched again. */
const DID_CACHE_MS = 60_000;

export interface AgentContext {
  /** The person: the token's `sub`. */
  ownerDid: string;
  /** The agent: the token's `act.sub`. */
  agentDid: string;
  clientId: string;
  /** What the Auth grant says, to prefill the person's approval. */
  requested: AgentLimits;
}

/**
 * AI agents allowed into a person's INITE wallet.
 *
 * Who an agent is, and that the person let it ask for the wallet, comes from
 * INITE Auth: the agent's DID in `act`, the `wallet:pay` grant approved with
 * a passkey. The first time the agent reaches for the wallet it is recorded
 * here as pending. The person then approves it in their account with the
 * wallet passkey, setting its limits: that makes the agent a Turnkey user in
 * their wallet, with a key billing holds and a policy that lets it sign only
 * USDC transfers up to the per-payment limit. Day and month limits, the site
 * list and the log are billing's.
 *
 * Revoking erases the agent's key: it can sign nothing from that moment. Auth
 * retiring the agent (the person disconnected the app) does the same, noticed
 * through the agent's DID document.
 */
@Injectable()
export class WalletAgentsService {
  private readonly logger = new Logger(WalletAgentsService.name);
  private readonly turnkey = new TurnkeyWallets();
  private readonly didCache = new Map<string, { at: number; live: boolean; name?: string }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** The person's wallet, or an error that tells the agent what the person must do. */
  async walletOf(ownerDid: string): Promise<Wallet> {
    const wallet = await this.prisma.wallet.findUnique({ where: { ownerDid } });
    if (!wallet) {
      throw new NotFoundException(
        `This person has no INITE wallet yet. Ask them to create one at ${this.accountUrl()}.`,
      );
    }
    return wallet;
  }

  /** The agent's record in the wallet, made pending on first use. Refuses a retired agent. */
  async enter(context: AgentContext): Promise<{ wallet: Wallet; agent: WalletAgent }> {
    const wallet = await this.walletOf(context.ownerDid);
    let agent = await this.prisma.walletAgent.upsert({
      where: { walletId_agentDid: { walletId: wallet.id, agentDid: context.agentDid } },
      create: {
        walletId: wallet.id,
        agentDid: context.agentDid,
        clientId: context.clientId,
        requested: context.requested as unknown as Prisma.InputJsonValue,
      },
      update: { requested: context.requested as unknown as Prisma.InputJsonValue },
    });
    if (agent.status !== 'revoked') {
      const did = await this.resolve(agent.agentDid);
      if (!did.live) agent = await this.retire(agent, 'retired in INITE Auth');
      else if (did.name && did.name !== agent.name) {
        agent = await this.prisma.walletAgent.update({
          where: { id: agent.id },
          data: { name: did.name },
        });
      }
    }
    if (agent.status === 'revoked') {
      throw new ConflictException('This agent no longer has access to the wallet');
    }
    return { wallet, agent };
  }

  /** The person's agents, newest first. */
  async list(ownerDid: string) {
    const wallet = await this.walletOf(ownerDid);
    const agents = await this.prisma.walletAgent.findMany({
      where: { walletId: wallet.id, kind: 'agent' },
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(agents.map((agent) => this.describe(agent)));
  }

  /**
   * Start or continue approving an agent with these limits. Returns the next
   * Turnkey request for the wallet passkey to stamp: making the agent's user,
   * then its policy.
   */
  async prepareApproval(ownerDid: string, agentId: string, input: Partial<AgentLimits>) {
    const { wallet, agent } = await this.mine(ownerDid, agentId);
    if (agent.status === 'revoked') throw new ConflictException('This agent was revoked');
    // The checkout user's own cap is the largest single payment; each site's
    // limits are kept per site (WalletMerchant).
    const limits =
      agent.kind === 'checkout'
        ? checkLimits({ perPayment: CHECKOUT_MAX_PAYMENT, daily: '2000', monthly: '10000' })
        : checkLimits(input);

    // The agent's key is made once, before its Turnkey user exists.
    const key = agent.apiPublicKey && agent.apiPrivateKey ? null : newTurnkeyApiKey();
    const step = agent.turnkeyUserId ? 'policy' : 'user';
    const request =
      step === 'user'
        ? this.createUserRequest(wallet, agent, key?.publicKey ?? agent.apiPublicKey!)
        : await this.createPolicyRequest(wallet, agent, agent.turnkeyUserId!, limits);
    await this.prisma.walletAgent.update({
      where: { id: agent.id },
      data: {
        ...(key ? { apiPublicKey: key.publicKey, apiPrivateKey: key.privateKey } : {}),
        pendingStep: step,
        pendingRequest: request,
        pendingLimits: limits as unknown as Prisma.InputJsonValue,
      },
    });
    return { step, request, credentialId: wallet.credentialId };
  }

  /**
   * The wallet passkey stamped the pending request: send it to Turnkey. After
   * the user step, the policy step is prepared and returned; after the policy
   * step the agent is active.
   */
  async confirmApproval(ownerDid: string, agentId: string, stamp: string) {
    const { wallet, agent } = await this.mine(ownerDid, agentId);
    if (!agent.pendingStep || !agent.pendingRequest || !agent.pendingLimits) {
      throw new ConflictException('Nothing is waiting for the passkey');
    }
    const limits = agent.pendingLimits as unknown as AgentLimits;
    let result: Record<string, any>;
    try {
      result = await this.turnkey.submitStamped(
        agent.pendingStep === 'user' ? CREATE_USERS_PATH : CREATE_POLICY_PATH,
        agent.pendingRequest,
        stamp,
      );
    } catch (error: any) {
      this.logger.warn(`Agent approval ${agent.id} (${agent.pendingStep}): ${error?.message}`);
      if (error instanceof TurnkeyRequestError && error.status < 500) {
        throw new BadRequestException('The passkey did not approve this; try again');
      }
      throw error;
    }

    if (agent.pendingStep === 'user') {
      const turnkeyUserId = findResult(result, 'userIds')?.[0];
      if (typeof turnkeyUserId !== 'string') throw new Error('Turnkey made no user');
      const request = await this.createPolicyRequest(wallet, agent, turnkeyUserId, limits);
      await this.prisma.walletAgent.update({
        where: { id: agent.id },
        data: { turnkeyUserId, pendingStep: 'policy', pendingRequest: request },
      });
      return { step: 'policy', request, credentialId: wallet.credentialId };
    }

    const policyId = findResult(result, 'policyId');
    const done = await this.prisma.walletAgent.update({
      where: { id: agent.id },
      data: {
        status: 'active',
        limits: limits as unknown as Prisma.InputJsonValue,
        policyId: typeof policyId === 'string' ? policyId : agent.policyId,
        approvedAt: new Date(),
        pendingStep: null,
        pendingRequest: null,
        pendingLimits: Prisma.DbNull,
      },
    });
    this.logger.log(`Agent ${agent.agentDid} approved for wallet ${wallet.address}`);
    return { step: 'done', agent: await this.describe(done) };
  }

  /** The person takes the wallet away from an agent. Its key is erased at once. */
  async revoke(ownerDid: string, agentId: string) {
    const { agent } = await this.mine(ownerDid, agentId);
    return this.describe(await this.retire(agent, 'revoked by the owner'));
  }

  /** What is left of an agent's limits, for the agent and the account page. */
  async describe(agent: WalletAgent) {
    const [today, thisMonth] = await Promise.all([
      this.spentSince(agent.id, dayAgo()),
      this.spentSince(agent.id, startOfMonth()),
    ]);
    return {
      id: agent.id,
      agentDid: agent.agentDid,
      clientId: agent.clientId,
      name: agent.name,
      status: agent.status,
      requested: agent.requested as unknown as AgentLimits,
      limits: (agent.limits as unknown as AgentLimits | null) ?? null,
      spent: { today: formatUnits(today, 6), month: formatUnits(thisMonth, 6) },
      approvedAt: agent.approvedAt,
      revokedAt: agent.revokedAt,
      lastUsedAt: agent.lastUsedAt,
      createdAt: agent.createdAt,
    };
  }

  /**
   * USDC an agent has committed since a moment: payments signed and not
   * known to have lapsed. A payment the seller refused still counts while its
   * authorization can be used; after that it counts only if it was used.
   */
  async spentSince(agentId: string, since: Date): Promise<bigint> {
    const rows = await this.prisma.walletAgentPayment.findMany({
      where: {
        agentId,
        createdAt: { gte: since },
        OR: [
          { status: { in: ['signing', 'paid'] } },
          { status: 'refused', validBefore: { gt: new Date() } },
        ],
      },
      select: { valueRaw: true },
    });
    return rows.reduce((sum, row) => sum + BigInt(row.valueRaw), 0n);
  }

  accountUrl(): string {
    return `${this.config.get<string>('AUTH_SERVICE_URL') || 'https://auth.inite.ai'}/account#inite-wallet`;
  }

  private async mine(ownerDid: string, agentId: string) {
    const wallet = await this.walletOf(ownerDid);
    const agent = await this.prisma.walletAgent.findFirst({
      where: { id: agentId, walletId: wallet.id },
    });
    if (!agent) throw new NotFoundException('No such agent');
    return { wallet, agent };
  }

  private retire(agent: WalletAgent, why: string) {
    this.logger.log(`Agent ${agent.agentDid}: ${why}`);
    return this.prisma.walletAgent.update({
      where: { id: agent.id },
      data: {
        status: 'revoked',
        revokedAt: agent.revokedAt ?? new Date(),
        apiPublicKey: null,
        apiPrivateKey: null,
        pendingStep: null,
        pendingRequest: null,
      },
    });
  }

  /**
   * Whether INITE Auth still vouches for the agent: its DID document, under
   * the issuer's own host, is live (410 once the person disconnected it).
   * Fails closed: an agent nobody can vouch for pays nothing.
   */
  async resolve(agentDid: string): Promise<{ live: boolean; name?: string }> {
    const cached = this.didCache.get(agentDid);
    if (cached && Date.now() - cached.at < DID_CACHE_MS) return cached;
    const url = this.didUrl(agentDid);
    if (!url) return { live: false };
    let entry: { at: number; live: boolean; name?: string };
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
      if (res.status === 410 || res.status === 404) {
        entry = { at: Date.now(), live: false };
      } else if (!res.ok) {
        throw new Error(`DID document: ${res.status}`);
      } else {
        const doc: any = await res.json();
        const name = doc?.service?.[0]?.serviceEndpoint?.name;
        entry = {
          at: Date.now(),
          live: doc?.id === agentDid,
          ...(typeof name === 'string' ? { name: name.slice(0, 255) } : {}),
        };
      }
    } catch (error: any) {
      throw new ConflictException(`INITE Auth could not confirm the agent now (${error?.message})`);
    }
    this.didCache.set(agentDid, entry);
    return entry;
  }

  /** did:web:<issuer host>:agents:<id> → its document URL; null for any other DID. */
  private didUrl(agentDid: string): string | null {
    const issuer = new URL(primaryIssuer(this.config));
    const host = issuer.port ? `${issuer.hostname}%3A${issuer.port}` : issuer.hostname;
    const match = /^did:web:([^:]+):agents:([0-9a-f-]{36})$/i.exec(agentDid);
    if (!match || match[1] !== host) return null;
    return `${issuer.origin}/agents/${match[2]}/did.json`;
  }

  private createUserRequest(wallet: Wallet, agent: WalletAgent, publicKey: string): string {
    return JSON.stringify({
      type: 'ACTIVITY_TYPE_CREATE_USERS_V4',
      timestampMs: String(Date.now()),
      organizationId: wallet.subOrganizationId,
      parameters: {
        users: [
          {
            userName: `Agent ${agent.name ?? agent.clientId}`.slice(0, 100),
            apiKeys: [{ apiKeyName: 'INITE billing', publicKey, curveType: 'API_KEY_CURVE_P256' }],
            authenticators: [],
            oauthProviders: [],
            userTags: [],
          },
        ],
      },
    });
  }

  private async createPolicyRequest(
    wallet: Wallet,
    agent: WalletAgent,
    turnkeyUserId: string,
    limits: AgentLimits,
  ): Promise<string> {
    let parameters;
    if (agent.kind === 'checkout') {
      const receiver = (await loadCryptoSettings(this.prisma))?.wallets.BASE;
      if (!receiver) throw new ConflictException('INITE checkout is not taking USDC on Base now');
      parameters = checkoutPolicy({ turnkeyUserId, receiver });
    } else {
      parameters = agentPolicy({
        turnkeyUserId,
        perPayment: limits.perPayment,
        name: agent.name ?? agent.clientId,
      });
    }
    return JSON.stringify({
      type: 'ACTIVITY_TYPE_CREATE_POLICY_V3',
      timestampMs: String(Date.now()),
      organizationId: wallet.subOrganizationId,
      parameters,
    });
  }

  /** The wallet's "INITE checkout" user record, made pending on first use. */
  async checkoutOf(wallet: Wallet): Promise<WalletAgent> {
    return this.prisma.walletAgent.upsert({
      where: { walletId_agentDid: { walletId: wallet.id, agentDid: CHECKOUT_AGENT_DID } },
      create: {
        walletId: wallet.id,
        agentDid: CHECKOUT_AGENT_DID,
        clientId: 'inite',
        kind: 'checkout',
        name: 'INITE checkout',
        requested: {} as Prisma.InputJsonValue,
      },
      update: {},
    });
  }
}

/** A field from whichever versioned result Turnkey filled in. */
function findResult(result: Record<string, any>, field: string): any {
  for (const value of Object.values(result ?? {})) {
    if (value && typeof value === 'object' && field in value) return value[field];
  }
  return undefined;
}

/** The day limit is a rolling 24 hours. */
export function dayAgo(now = new Date()): Date {
  return new Date(now.getTime() - 24 * 60 * 60 * 1000);
}

/** The month limit is the calendar month, UTC. */
export function startOfMonth(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
