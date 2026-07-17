import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ServiceAuthGuard } from '../auth/guards/service-auth.guard';
import { CatalogService } from './catalog.service';

/**
 * Service-level API for managing own products and prices.
 * Authenticated via x-api-key header.
 * All operations are scoped to the service that owns the API key.
 */
@ApiTags('Service Catalog')
@Controller('v1/service/catalog')
@UseGuards(ServiceAuthGuard)
export class ServiceCatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  // ─── Products ──────────────────────────────────────────────

  @Get('products')
  @ApiOperation({ summary: 'List products for this service' })
  async getProducts(@Req() req: any) {
    return this.catalogService.getServiceProducts(req.user.serviceId);
  }

  @Post('products')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a product for this service' })
  async createProduct(
    @Req() req: any,
    @Body()
    body: {
      code: string;
      name: string;
      type: 'subscription' | 'one_time' | 'usage';
      moduleScope?: string;
      metadata?: any;
    },
  ) {
    return this.catalogService.createServiceProduct(req.user.serviceId, body);
  }

  @Put('products/:id')
  @ApiOperation({ summary: 'Update a product' })
  async updateProduct(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { name?: string; isActive?: boolean; metadata?: any },
  ) {
    return this.catalogService.updateServiceProduct(req.user.serviceId, id, body);
  }

  @Delete('products/:id')
  @ApiOperation({ summary: 'Delete a product' })
  async deleteProduct(@Req() req: any, @Param('id') id: string) {
    return this.catalogService.deleteServiceProduct(req.user.serviceId, id);
  }

  // ─── Prices ────────────────────────────────────────────────

  @Get('prices')
  @ApiOperation({ summary: 'List prices for this service' })
  async getPrices(@Req() req: any) {
    return this.catalogService.getServicePrices(req.user.serviceId);
  }

  @Post('prices')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a price for a product' })
  async createPrice(
    @Req() req: any,
    @Body()
    body: {
      code: string;
      productId: string;
      amount: number;
      currency: string;
      interval?: string;
      trialDays?: number;
      graceDays?: number;
      metadata?: any;
    },
  ) {
    return this.catalogService.createServicePrice(req.user.serviceId, body);
  }

  @Put('prices/:id')
  @ApiOperation({ summary: 'Update a price' })
  async updatePrice(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { amount?: number; isActive?: boolean; metadata?: any },
  ) {
    return this.catalogService.updateServicePrice(req.user.serviceId, id, body);
  }

  @Delete('prices/:id')
  @ApiOperation({ summary: 'Delete a price' })
  async deletePrice(@Req() req: any, @Param('id') id: string) {
    return this.catalogService.deleteServicePrice(req.user.serviceId, id);
  }
}
