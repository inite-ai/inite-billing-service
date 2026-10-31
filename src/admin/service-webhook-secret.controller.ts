import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { randomBytes } from 'node:crypto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PrismaService } from '../common/services/prisma.service';
import { canSeal } from '../common/key-seal';
import { sealWebhookSecret } from '../workers/outbox-signature';

/**
 * A service's own webhook secret. A service that signs in to billing only
 * with an INITE Auth token (the service-token lane) should not need the
 * static API key just to verify billing's webhooks; this gives it a secret
 * of its own. Shown once, when made; stored sealed (KEY_SEAL_SECRET).
 * Removing it puts the service back on its API key.
 */
@ApiTags('Admin')
@Controller('v1/admin/services/:id/webhook-secret')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class ServiceWebhookSecretController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Make (or rotate) a service’s webhook secret; shown once' })
  async rotate(@Param('id', new ParseUUIDPipe()) id: string) {
    const service = await this.prisma.service.findUnique({ where: { id } });
    if (!service) throw new NotFoundException(`Service not found: ${id}`);
    if (!canSeal()) {
      throw new ServiceUnavailableException('KEY_SEAL_SECRET is not set: no secret can be kept');
    }
    const webhookSecret = `whsec_${randomBytes(32).toString('base64url')}`;
    await this.prisma.service.update({
      where: { id },
      data: { webhookSecret: sealWebhookSecret(webhookSecret, id) },
    });
    return { serviceId: id, webhookSecret };
  }

  @Delete()
  @ApiOperation({
    summary: 'Remove a service’s webhook secret (webhooks sign with its API key again)',
  })
  async remove(@Param('id', new ParseUUIDPipe()) id: string) {
    const service = await this.prisma.service.findUnique({ where: { id } });
    if (!service) throw new NotFoundException(`Service not found: ${id}`);
    await this.prisma.service.update({ where: { id }, data: { webhookSecret: null } });
    return { serviceId: id, webhookSecret: null };
  }
}
