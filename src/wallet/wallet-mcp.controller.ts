import { Controller, All, Get, Logger, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { RequestUser, User } from '../auth/decorators/user.decorator';
import { AgentTokenGuard, walletResource } from './agent-token.guard';
import { limitsFromGrant, WALLET_SCOPE } from './agent-limits';
import { AgentContext } from './wallet-agents.service';
import { AgentPaymentsService, PaymentRefused } from './agent-payments.service';
import { SelfAgentWalletService } from './self-agent-wallet.service';
import {
  WALLET_WIDGET_HTML,
  WALLET_WIDGET_URI,
  WIDGET_MIME,
  addressQr,
  walletWidgetMeta,
} from './wallet-widget';
import { primaryIssuer } from '../auth/token-contract';

const INSTRUCTIONS =
  'The INITE wallet of the person you act for: their own USDC on Base. ' +
  'Use `pay` to fetch a URL that may cost money: if the site answers 402 (x402), the wallet pays it ' +
  'within maxAmount and the limits the person set, and you get the site’s answer. ' +
  '`wallet_balance` shows the balance and what is left of the limits. ' +
  'If the agent is not approved yet, tell the person to approve it in their INITE account.';

const SELF_INSTRUCTIONS =
  'Your own INITE wallet: USDC on Base that belongs to you, the agent. ' +
  '`wallet` opens it if needed and shows the address, balance and a top-up link to give a person. ' +
  '`pay` fetches a URL and, if it answers 402 (x402), pays at most maxAmount from the wallet. ' +
  'If INITE keeps your key, that is the whole payment; if you hold your own key, `pay` returns a ' +
  'Turnkey request to stamp with it, and `pay_confirm` sends the stamp.';

/**
 * The INITE wallet, spoken as MCP to AI agents (`/mcp/wallet`).
 *
 * Every request carries the agent's token for this resource (AgentTokenGuard);
 * the person and the agent come from it, never from tool arguments. Stateless,
 * like the billing MCP: a server per request.
 */
@Controller()
export class WalletMcpController {
  private readonly logger = new Logger(WalletMcpController.name);

  constructor(
    private readonly payments: AgentPaymentsService,
    private readonly agentWallets: SelfAgentWalletService,
    private readonly config: ConfigService,
  ) {}

  /** RFC 9728: where an agent gets a token for the wallet. */
  @Get(['.well-known/oauth-protected-resource/mcp/wallet'])
  @ApiExcludeEndpoint()
  metadata(@Res() res: Response) {
    res
      .set('Access-Control-Allow-Origin', '*')
      .set('Cache-Control', 'public, max-age=3600')
      .json({
        resource: walletResource(this.config),
        resource_name: 'INITE wallet',
        authorization_servers: [primaryIssuer(this.config)],
        scopes_supported: [WALLET_SCOPE],
        bearer_methods_supported: ['header'],
        resource_documentation: 'https://billing.inite.ai/docs/wallet',
      });
  }

  @All('mcp/wallet')
  @UseGuards(AgentTokenGuard)
  @ApiExcludeEndpoint()
  async handle(@User() user: RequestUser, @Req() req: Request, @Res() res: Response) {
    if (req.method !== 'POST') {
      res
        .status(405)
        .set('Allow', 'POST')
        .json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'This endpoint is stateless — use POST.' },
          id: null,
        });
      return;
    }
    // AgentTokenGuard let in either an agent acting for a person (`act`) or
    // an agent on its own (its did:web as `sub`).
    const server = user.actor
      ? this.server({
          ownerDid: user.userId,
          agentDid: user.actor,
          clientId: user.actorClientId ?? '',
          requested: limitsFromGrant(user.authorizationDetails),
        })
      : this.selfServer(user.userId);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error: any) {
      this.logger.error(`Wallet MCP request failed: ${error.message}`);
      if (!res.headersSent) {
        res
          .status(500)
          .json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
      }
    }
  }

  /** The wallet MCP for an agent on its own: its own wallet, opened on first use. */
  private selfServer(did: string): McpServer {
    const server = new McpServer(
      { name: 'inite-wallet', version: '1.1.0' },
      { instructions: SELF_INSTRUCTIONS },
    );
    const register = annotated(server);
    registerWidget(server);
    const fail = (error: any) => ({
      ...text({ message: error?.response?.message ?? error?.message ?? 'Failed' }),
      isError: true,
    });
    const run = async (fn: () => Promise<unknown>) => {
      try {
        return text(await fn());
      } catch (error) {
        return fail(error);
      }
    };
    const card = async () => {
      let o: any = await this.agentWallets.overview(did);
      if (!o.wallet) o = await this.agentWallets.open(did);
      return {
        address: o.wallet.address,
        balance: o.wallet.balance,
        custody: o.wallet.custody,
        network: o.wallet.network,
        asset: 'USDC',
        fundUrl: o.fundUrl,
        fund: o.fund,
        qrSvg: await addressQr(o.wallet.address),
        payments: o.payments,
      };
    };

    register(
      'wallet',
      {
        title: 'My wallet',
        description:
          'Your own INITE wallet (opened on first call): address on Base, USDC balance, who keeps the key, a top-up link for a person (QR, PIX), recent payments.',
        inputSchema: {},
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
        _meta: walletWidgetMeta,
      },
      () => cardResult(card),
    );
    register(
      'pay',
      {
        title: 'Fetch a URL, paying with x402 if asked',
        description:
          'Request a URL. If the site answers 402 with x402 terms (USDC on Base), pay at most maxAmount from your wallet and return the site’s answer. With your own key, returns the request to stamp; then call pay_confirm.',
        inputSchema: {
          url: z
            .string()
            .url()
            .describe('https URL of the paid resource, e.g. a checkout’s x402Url'),
          method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
          headers: z.record(z.string(), z.string()).optional(),
          body: z.string().max(100_000).optional(),
          maxAmount: z.string().describe('The most you agree to pay, in USDC, e.g. "15"'),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      (args) => run(() => this.agentWallets.pay(did, args as any)),
    );
    register(
      'pay_confirm',
      {
        title: 'Send a payment you stamped',
        description:
          'For a wallet you own by your key: send the X-Stamp you made over the request `pay` returned.',
        inputSchema: {
          paymentId: z.string().uuid(),
          stamp: z
            .string()
            .max(4096)
            .describe('Turnkey X-Stamp value (ApiKeyStamper) over the exact request'),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      (args) => run(() => this.agentWallets.confirm(did, args.paymentId, args.stamp)),
    );
    register(
      'withdraw',
      {
        title: 'Send USDC out',
        description:
          'Send USDC from your wallet to a Base address. With an INITE-kept key it is sent at once; with your own key you get the request to stamp.',
        inputSchema: {
          to: z.string().describe('Base address, 0x…'),
          amount: z.string().describe('USDC, e.g. "5"'),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      (args) => run(() => this.agentWallets.withdraw(did, args as any)),
    );
    return server;
  }

  private server(context: AgentContext): McpServer {
    const server = new McpServer(
      { name: 'inite-wallet', version: '1.0.0' },
      { instructions: INSTRUCTIONS },
    );
    const register = annotated(server);
    const runCard = (fn: () => Promise<Record<string, unknown>>) => cardResult(fn);
    const run = async (fn: () => Promise<unknown>) => {
      try {
        return text(await fn());
      } catch (error: any) {
        const body =
          error instanceof PaymentRefused
            ? { paid: null, reason: error.reason, message: error.message, ...error.extra }
            : { paid: null, message: error?.response?.message ?? error?.message ?? 'Failed' };
        return { ...text(body), isError: true };
      }
    };

    registerWidget(server);
    const card = async () => {
      const b: any = await this.payments.balance(context);
      const history = await this.payments.history(context).catch(() => []);
      return {
        ...b,
        qrSvg: await addressQr(b.address),
        // The person tops up in their INITE ID account, or on the public page.
        fundUrl: b.address ? this.agentWallets.fundUrl(b.address) : null,
        limits: b.limits
          ? `Limits: ${b.limits.perPayment} a payment · ${b.limits.daily} a day · ${b.limits.monthly} a month`
          : null,
        payments: history.map((p: any) => ({ ...p, currency: 'USDC' })),
      };
    };
    register(
      'wallet_balance',
      {
        title: 'Wallet balance and limits',
        description:
          'USDC balance of the person’s INITE wallet, this agent’s limits, and how much of today’s and this month’s limit is left.',
        inputSchema: {},
        annotations: { readOnlyHint: true },
        _meta: walletWidgetMeta,
      },
      () => runCard(card),
    );
    register(
      'wallet_address',
      {
        title: 'Wallet address',
        description:
          'The wallet’s address on Base, for the person to top it up with USDC. Only USDC on Base can be sent there.',
        inputSchema: {},
        annotations: { readOnlyHint: true },
        _meta: walletWidgetMeta,
      },
      () => runCard(card),
    );
    register(
      'pay',
      {
        title: 'Fetch a URL, paying with x402 if asked',
        description:
          'Request a URL. If the site answers 402 with x402 terms (USDC on Base), pay at most maxAmount from the wallet, within this agent’s limits, and return the site’s answer. Without a 402 nothing is paid.',
        inputSchema: {
          url: z.string().url().describe('https URL of the paid resource'),
          method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
          headers: z.record(z.string(), z.string()).optional().describe('Extra request headers'),
          body: z.string().max(100_000).optional().describe('Request body, e.g. JSON text'),
          maxAmount: z.string().describe('The most you agree to pay, in USDC, e.g. "1.50"'),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      (args) => run(() => this.payments.pay(context, args as any)),
    );
    register(
      'payments',
      {
        title: 'Payments made',
        description: 'This agent’s recent payments from the wallet.',
        inputSchema: {},
        annotations: { readOnlyHint: true },
      },
      () => run(() => this.payments.history(context)),
    );
    return server;
  }
}

/**
 * registerTool with all four hints filled (app directories flag tools without
 * them; read-only tools touch nothing outside the wallet), cast at the
 * boundary: registerTool's inference over literal zod schemas recurses too deep.
 */
function annotated(server: McpServer) {
  const bound = server.registerTool.bind(server) as (
    name: string,
    config: Record<string, unknown>,
    cb: (args: Record<string, any>) => Promise<unknown>,
  ) => unknown;
  return (
    name: string,
    config: Record<string, unknown>,
    cb: (args: Record<string, any>) => Promise<unknown>,
  ) => {
    const a = (config.annotations ?? {}) as Record<string, boolean | undefined>;
    const readOnly = a.readOnlyHint ?? false;
    return bound(
      name,
      {
        ...config,
        annotations: {
          ...a,
          title: config.title,
          readOnlyHint: readOnly,
          destructiveHint: a.destructiveHint ?? false,
          idempotentHint: a.idempotentHint ?? readOnly,
          openWorldHint: a.openWorldHint ?? !readOnly,
        },
      },
      cb,
    );
  };
}

async function cardResult(fn: () => Promise<Record<string, unknown>>) {
  try {
    const data = await fn();
    const { qrSvg: _qr, ...rest } = data;
    // Text for clients without UI (no SVG in it); the card reads structuredContent.
    return { ...text(rest), structuredContent: data };
  } catch (error: any) {
    return {
      ...text({ message: error?.response?.message ?? error?.message ?? 'Failed' }),
      isError: true,
    };
  }
}

/** The wallet card (MCP Apps / ChatGPT Apps SDK), served as a ui:// resource. */
function registerWidget(server: McpServer) {
  (server.registerResource.bind(server) as any)(
    'wallet-card',
    WALLET_WIDGET_URI,
    { title: 'INITE wallet', mimeType: WIDGET_MIME },
    async () => ({
      contents: [
        {
          uri: WALLET_WIDGET_URI,
          mimeType: WIDGET_MIME,
          text: WALLET_WIDGET_HTML,
          _meta: {
            ui: { prefersBorder: true },
            'openai/widgetPrefersBorder': true,
            'openai/widgetDescription':
              'The INITE wallet: balance, address to top up, recent payments.',
          },
        },
      ],
    }),
  );
}

function text(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}
