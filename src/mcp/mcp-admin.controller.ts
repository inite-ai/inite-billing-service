import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PrismaService } from '../common/services/prisma.service';
import { McpServersService } from './mcp-servers.service';
import { RegisterMcpServerDto, UpdateMcpServerDto } from './dto/mcp-server.dto';

class AdminRegisterMcpServerDto extends RegisterMcpServerDto {
  /** The operator the server is filed under — the admin registers on their behalf. */
  @IsUUID()
  serviceId: string;
}

function windowDays(days?: string): number {
  return days ? Math.min(Math.max(parseInt(days, 10) || 30, 1), 365) : 30;
}

/**
 * The platform admin's view of the MCP gateway: every operator's servers.
 *
 * It holds no rules of its own. Each write resolves the server's operator and
 * goes through the same service the operator's own key uses, so validation,
 * the SSRF check and secret handling cannot differ between the two doors.
 */
@ApiTags('Admin')
@Controller('v1/admin/mcp/servers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class McpAdminController {
  constructor(
    private readonly servers: McpServersService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'All proxied MCP servers with calls and credits in the window' })
  async overview(@Query('days') days?: string) {
    return this.servers.overview(windowDays(days));
  }

  @Post()
  @ApiOperation({ summary: 'Register an MCP server on behalf of a service' })
  async register(@Body() body: AdminRegisterMcpServerDto) {
    const { serviceId, ...input } = body;
    const service = await this.prisma.service.findUnique({ where: { id: serviceId } });
    if (!service) throw new NotFoundException(`Service not found: ${serviceId}`);
    return this.servers.register(serviceId, input);
  }

  @Get(':id/usage')
  @ApiOperation({ summary: 'Calls and credits for one server, with the latest calls' })
  async usage(@Param('id') id: string, @Query('days') days?: string) {
    return this.servers.usage(await this.servers.operatorOf(id), id, windowDays(days));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Change a proxied MCP server' })
  async update(@Param('id') id: string, @Body() body: UpdateMcpServerDto) {
    return this.servers.update(await this.servers.operatorOf(id), id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Unregister a proxied MCP server' })
  async remove(@Param('id') id: string) {
    return this.servers.remove(await this.servers.operatorOf(id), id);
  }
}
