import { Controller, Get, Query, Req, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CatalogService } from './catalog.service';
import { ProductResponseDto, PriceResponseDto } from '../common/dto/catalog.dto';
import { OptionalServiceGuard } from './optional-service.guard';

@ApiTags('Catalog')
@Controller('v1/products')
@UseGuards(OptionalServiceGuard)
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get active products (filtered by service if x-api-key provided)' })
  @ApiResponse({ status: 200, type: [ProductResponseDto] })
  async getProducts(
    @Req() req: any,
    @Query('serviceId') serviceId?: string,
  ): Promise<ProductResponseDto[]> {
    const effectiveServiceId = req.user?.serviceId || serviceId;
    return this.catalogService.getProducts(effectiveServiceId);
  }

  @Get('prices')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get prices, optionally filtered by product code' })
  @ApiResponse({ status: 200, type: [PriceResponseDto] })
  async getPrices(
    @Req() req: any,
    @Query('product_code') productCode?: string,
    @Query('serviceId') serviceId?: string,
  ): Promise<PriceResponseDto[]> {
    const effectiveServiceId = req.user?.serviceId || serviceId;
    return this.catalogService.getPrices(productCode, effectiveServiceId);
  }
}
