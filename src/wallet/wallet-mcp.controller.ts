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

const INSTRUCTIONS =
  'The INITE wallet of the person you act for: their own USDC on Base. ' +
  'Use `pay` to fetch a URL that may cost money: if the site answers 402 (x402), the wallet pays it ' +
  'within maxAmount and the limits the person set, and you get the site’s answer. ' +
  '`wallet_balance` shows the balance and what is left of the limits. ' +
  'If the agent is not approved yet, tell the person to approve it in their INITE account.';

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
        authorization_servers: [
          this.config.get<string>('JWT_ISSUER') || 'https://auth-api.inite.ai',
        ],
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
    const context: AgentContext = {
      ownerDid: user.userId,
      agentDid: user.actor!,
      clientId: user.actorClientId ?? '',
      requested: limitsFromGrant(user.authorizationDetails),
    };
    const server = this.server(context);
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

  private server(context: AgentContext): McpServer {
    const server = new McpServer(
      { name: 'inite-wallet', version: '1.0.0' },
      { instructions: INSTRUCTIONS },
    );
    // Cast at the boundary, as the billing MCP does: registerTool's inference
    // over literal zod schemas recurses too deep. The schemas still validate.
    const register = server.registerTool.bind(server) as (
      name: string,
      config: Record<string, unknown>,
      cb: (args: Record<string, any>) => Promise<unknown>,
    ) => unknown;
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

    register(
      'wallet_balance',
      {
        title: 'Wallet balance and limits',
        description:
          'USDC balance of the person’s INITE wallet, this agent’s limits, and how much of today’s and this month’s limit is left.',
        inputSchema: {},
        annotations: { readOnlyHint: true },
      },
      () => run(() => this.payments.balance(context)),
    );
    register(
      'wallet_address',
      {
        title: 'Wallet address',
        description:
          'The wallet’s address on Base, for the person to top it up with USDC. Only USDC on Base can be sent there.',
        inputSchema: {},
        annotations: { readOnlyHint: true },
      },
      () =>
        run(async () => {
          const b = await this.payments.balance(context);
          return { address: b.address, network: b.network, asset: b.asset };
        }),
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
          headers: z.record(z.string()).optional().describe('Extra request headers'),
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

function text(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}
