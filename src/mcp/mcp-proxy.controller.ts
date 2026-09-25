import { Controller, All, Param, Req, Res, UseGuards, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiTags, ApiExcludeEndpoint } from '@nestjs/swagger';
import { JwtOrServiceGuard } from '../auth/guards/jwt-or-service.guard';
import { User, RequestUser } from '../auth/decorators/user.decorator';
import { McpProxyService } from './mcp-proxy.service';
import { McpCaller } from './mcp-tools.service';

/**
 * The billed front door to somebody else's MCP server.
 *
 * An agent points at `/mcp/s/<slug>` and speaks ordinary MCP; this
 * authenticates the caller, decides whether the call is paid for, forwards it
 * to the operator's own server, and meters what came back. The operator writes
 * no billing code and the agent needs no special client.
 */
@ApiTags('MCP')
@Controller('mcp/s')
@UseGuards(JwtOrServiceGuard)
export class McpProxyController {
  private readonly logger = new Logger(McpProxyController.name);

  constructor(private readonly proxy: McpProxyService) {}

  @All(':slug')
  @ApiExcludeEndpoint()
  async handle(
    @Param('slug') slug: string,
    @User() user: RequestUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
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

    const caller: McpCaller = {
      userId: user.userId,
      isService: Boolean(user.isService),
      serviceId: user.serviceId,
      roles: user.roles ?? [],
    };

    // Forwarded verbatim. Re-serialising would change bytes the upstream may
    // have opinions about, and this service has no reason to rewrite a message
    // it is only carrying.
    const rawBody = JSON.stringify(req.body ?? {});

    const answer = await this.proxy.handle(slug, caller, req.body, rawBody);
    res.status(answer.status).type(answer.contentType).send(answer.body);
  }
}
