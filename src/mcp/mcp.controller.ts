import { Controller, All, Req, Res, UseGuards, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiTags, ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { JwtOrServiceGuard } from '../auth/guards/jwt-or-service.guard';
import { User, RequestUser } from '../auth/decorators/user.decorator';
import { McpCaller, McpToolsService } from './mcp-tools.service';
import { MCP_SERVER_NAME, MCP_SERVER_VERSION } from './mcp.constants';

/**
 * This billing service, spoken as MCP.
 *
 * An agent that can ask "is this customer entitled to what they just asked
 * for", charge for the work, and hand back a payment link when the answer is
 * no, does not need a human to wire three REST calls together first.
 *
 * Stateless on purpose: every request carries its own credentials and is
 * answered on its own. A session would mean holding one caller's identity
 * between requests, which is a thing to get wrong for no gain here — there is
 * no long-running server state to keep, and horizontal replicas would each need
 * their own copy of it.
 */
@ApiTags('MCP')
@Controller('mcp')
@UseGuards(JwtOrServiceGuard)
export class McpController {
  private readonly logger = new Logger(McpController.name);

  constructor(private readonly tools: McpToolsService) {}

  @All()
  @ApiOperation({
    summary: 'MCP endpoint (streamable HTTP). POST JSON-RPC; authenticate as any other API caller.',
  })
  @ApiExcludeEndpoint()
  async handle(
    @User() user: RequestUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (req.method !== 'POST') {
      // No session to resume and no server-initiated stream to open, so the
      // GET and DELETE halves of the transport have nothing to answer.
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

    const caller: McpCaller = {
      userId: user.userId,
      isService: Boolean(user.isService),
      serviceId: user.serviceId,
      roles: user.roles ?? [],
    };

    const server = this.buildServer(caller);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    // Both ends are per-request, so they have to be closed with it — otherwise
    // every call leaks a server and its transport.
    res.on('close', () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error: any) {
      this.logger.error(`MCP request failed: ${error.message}`, error.stack);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal error' },
          id: null,
        });
      }
    }
  }

  /**
   * A server instance bound to this caller.
   *
   * The tools come from {@link McpToolsService} — the one place they are
   * defined — and close over the identity the guard established, so no argument
   * an agent invents can change who the work is done for.
   */
  private buildServer(caller: McpCaller): McpServer {
    const server = new McpServer(
      { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
      {
        instructions:
          'Billing for the INITE platform. Before doing paid work call check_entitlement or ' +
          'get_credit_balance; after doing it call consume_credits with an idempotency_key. ' +
          'When a customer has neither entitlement nor credits, create_checkout_session returns ' +
          'a URL to send them to rather than an error.',
      },
    );

    for (const tool of this.tools.list()) {
      // Cast at the boundary: `registerTool` infers its callback's argument
      // type from a *literal* schema, and these come out of an array at
      // runtime, which sends the inference infinite. The shapes themselves are
      // real zod and still validate every call.
      const register = server.registerTool.bind(server) as (
        name: string,
        config: Record<string, unknown>,
        cb: (args: Record<string, any>) => Promise<unknown>,
      ) => unknown;

      register(
        tool.name,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: {
            readOnlyHint: tool.readOnly,
            // Nothing here deletes anything; the writes create orders and
            // ledger rows.
            destructiveHint: false,
            idempotentHint: tool.readOnly,
          },
        },
        async (args: Record<string, any>) => this.tools.call(tool.name, args, caller),
      );
    }

    return server;
  }
}
