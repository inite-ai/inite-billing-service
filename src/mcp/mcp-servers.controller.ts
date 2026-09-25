import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ServiceAuthGuard } from '../auth/guards/service-auth.guard';
import { User, RequestUser } from '../auth/decorators/user.decorator';
import { McpServersService } from './mcp-servers.service';
import { RegisterMcpServerDto, UpdateMcpServerDto } from './dto/mcp-server.dto';
import { publicApiValidation } from '../common/pipes/public-api-validation.pipe';

/**
 * Where an operator registers a server to be billed for.
 *
 * Service key only: an operator *is* a registered service here, and the
 * service the key belongs to is the one the server is filed under — never a
 * value from the request, so no key can register a server in somebody else's
 * name or read one that isn't theirs.
 */
@ApiTags('MCP')
@ApiBearerAuth()
@Controller('v1/mcp/servers')
@UseGuards(ServiceAuthGuard)
export class McpServersController {
  constructor(private readonly servers: McpServersService) {}

  private operator(user: RequestUser): string {
    if (!user.isService || !user.serviceId) {
      throw new ForbiddenException('Registering an MCP server needs a service key');
    }
    return user.serviceId;
  }

  @Get()
  @ApiOperation({ summary: 'List the MCP servers this service has registered' })
  async list(@User() user: RequestUser) {
    return this.servers.list(this.operator(user));
  }

  @Post()
  @ApiOperation({ summary: 'Register an MCP server to be billed for' })
  async register(
    @User() user: RequestUser,
    @Body(publicApiValidation()) body: RegisterMcpServerDto,
  ) {
    return this.servers.register(this.operator(user), body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One registered server' })
  async get(@User() user: RequestUser, @Param('id') id: string) {
    return this.servers.get(this.operator(user), id);
  }

  @Get(':id/usage')
  @ApiOperation({ summary: 'Calls and credits for a registered server' })
  async usage(
    @User() user: RequestUser,
    @Param('id') id: string,
    @Query('days') days?: string,
  ) {
    const window = days ? Math.min(Math.max(parseInt(days, 10) || 30, 1), 365) : 30;
    return this.servers.usage(this.operator(user), id, window);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Change a registered server' })
  async update(
    @User() user: RequestUser,
    @Param('id') id: string,
    @Body(publicApiValidation()) body: UpdateMcpServerDto,
  ) {
    return this.servers.update(this.operator(user), id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Unregister a server' })
  async remove(@User() user: RequestUser, @Param('id') id: string) {
    return this.servers.remove(this.operator(user), id);
  }
}
