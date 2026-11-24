import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PayabilityService } from '../checkout/payability.service';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('v1/admin/payable-prices')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class PayablePricesController {
  constructor(private readonly payable: PayabilityService) {}

  @Get()
  @ApiOperation({ summary: 'Active prices no active rail can charge in their own currency' })
  async list() {
    return this.payable.unpayable();
  }
}
