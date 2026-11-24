import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { User, RequestUser } from '../auth/decorators/user.decorator';
import { InvoicingService } from './invoicing.service';
import { MarkInvoicePaidDto } from './invoicing.dto';

/** Invoices of every service, for an admin: read, mark paid by hand, cancel. */
@ApiTags('Admin Invoices')
@Controller('v1/admin/invoices')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminInvoicesController {
  constructor(private readonly invoicing: InvoicingService) {}

  @Get()
  @ApiOperation({ summary: 'The newest invoices' })
  async list(@Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number) {
    return this.invoicing.list(limit);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read an invoice' })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoicing.get({ admin: true }, id);
  }

  @Post(':id/mark-paid')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record that the invoice was paid another way' })
  async markPaid(
    @User() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkInvoicePaidDto,
  ) {
    return this.invoicing.markPaid({ admin: true }, id, dto, `admin:${user.userId}`);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel an unpaid invoice' })
  async cancel(@User() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.invoicing.cancel({ admin: true }, id, `admin:${user.userId}`);
  }
}
