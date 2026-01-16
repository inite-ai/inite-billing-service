import { Controller, Get, Query, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CatalogService } from './catalog.service';
import { ProductResponseDto, PriceResponseDto } from '../common/dto/catalog.dto';

@ApiTags('Catalog')
@Controller('v1/products')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get all active products' })
  @ApiResponse({ status: 200, type: [ProductResponseDto] })
  async getProducts(): Promise<ProductResponseDto[]> {
    return this.catalogService.getProducts();
  }

  @Get('prices')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get prices, optionally filtered by product code' })
  @ApiResponse({ status: 200, type: [PriceResponseDto] })
  async getPrices(@Query('product_code') productCode?: string): Promise<PriceResponseDto[]> {
    return this.catalogService.getPrices(productCode);
  }
}

