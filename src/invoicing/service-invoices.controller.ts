import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ServiceAuthGuard } from '../auth/guards/service-auth.guard';
import { InvoicingService } from './invoicing.service';
import { CreateInvoiceDto, MarkInvoicePaidDto } from './invoicing.dto';

/**
 * Invoices for the service that owns the API key (x-api-key, the key inite.ai
 * already holds): open one as an open sale, read it, mark it
 * paid when the money came another way, cancel an unpaid one. A service sees
 * only invoices on its own prices.
 */
@ApiTags('Service Invoices')
@Controller('v1/service/invoices')
@UseGuards(ServiceAuthGuard)
export class ServiceInvoicesController {
  constructor(private readonly invoicing: InvoicingService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'Open an invoice; returns its payment link' })
  @ApiHeader({ name: 'idempotency-key', required: true })
  async create(
    @Req() req: any,
    @Body() dto: CreateInvoiceDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    if (!idempotencyKey?.trim())
      throw new BadRequestException('idempotency-key header is required');
    // The buyer is checked against the buyer pattern (DTO), as POST
    // /v1/checkout/sessions does under a service key, not against the
    // service code: a site's guest ids are named for the site, and inite.ai's
    // (`initeai:<hash>`, claimed on sign-in) predate its service code.
    return this.invoicing.create(
      { serviceId: req.user.serviceId, serviceCode: req.user.serviceCode },
      dto,
      idempotencyKey.trim(),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read an invoice' })
  async get(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.invoicing.get({ serviceId: req.user.serviceId }, id);
  }

  @Post(':id/mark-paid')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Record that the invoice was paid another way (PIX to the account, transfer)',
  })
  async markPaid(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkInvoicePaidDto,
  ) {
    return this.invoicing.markPaid(
      { serviceId: req.user.serviceId },
      id,
      dto,
      `service:${req.user.serviceId}`,
    );
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel an unpaid invoice' })
  async cancel(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.invoicing.cancel(
      { serviceId: req.user.serviceId },
      id,
      `service:${req.user.serviceId}`,
    );
  }
}
