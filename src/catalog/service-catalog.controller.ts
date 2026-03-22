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
import { PrismaService } from '../common/services/prisma.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

/**
 * Service-level API for managing own products and prices.
 * Authenticated via x-api-key header.
 * All operations are scoped to the service that owns the API key.
 */
@ApiTags('Service Catalog')
@Controller('v1/service/catalog')
@UseGuards(ServiceAuthGuard)
export class ServiceCatalogController {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Products ──────────────────────────────────────────────

  @Get('products')
  @ApiOperation({ summary: 'List products for this service' })
  async getProducts(@Req() req: any) {
    return this.prisma.product.findMany({
      where: { serviceId: req.user.serviceId },
      include: { prices: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post('products')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a product for this service' })
  async createProduct(
    @Req() req: any,
    @Body() body: {
      code: string;
      name: string;
      type: 'subscription' | 'one_time' | 'usage';
      moduleScope?: string;
      metadata?: any;
    },
  ) {
    const existing = await this.prisma.product.findFirst({
      where: { code: body.code, serviceId: req.user.serviceId },
    });
    if (existing) {
      throw new BadRequestException(`Product with code '${body.code}' already exists`);
    }

    return this.prisma.product.create({
      data: {
        ...body,
        moduleScope: body.moduleScope || 'default',
        serviceId: req.user.serviceId,
      },
    });
  }

  @Put('products/:id')
  @ApiOperation({ summary: 'Update a product' })
  async updateProduct(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { name?: string; isActive?: boolean; metadata?: any },
  ) {
    const product = await this.prisma.product.findFirst({
      where: { id, serviceId: req.user.serviceId },
    });
    if (!product) throw new NotFoundException('Product not found');
    return this.prisma.product.update({ where: { id }, data: body });
  }

  @Delete('products/:id')
  @ApiOperation({ summary: 'Delete a product' })
  async deleteProduct(@Req() req: any, @Param('id') id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, serviceId: req.user.serviceId },
    });
    if (!product) throw new NotFoundException('Product not found');
    return this.prisma.product.delete({ where: { id } });
  }

  // ─── Prices ────────────────────────────────────────────────

  @Get('prices')
  @ApiOperation({ summary: 'List prices for this service' })
  async getPrices(@Req() req: any) {
    return this.prisma.price.findMany({
      where: { product: { serviceId: req.user.serviceId } },
      include: { product: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post('prices')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a price for a product' })
  async createPrice(
    @Req() req: any,
    @Body() body: {
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
    // Verify product belongs to this service
    const product = await this.prisma.product.findFirst({
      where: { id: body.productId, serviceId: req.user.serviceId },
    });
    if (!product) {
      throw new BadRequestException('Product not found or does not belong to this service');
    }

    return this.prisma.price.create({
      data: {
        code: body.code,
        productId: body.productId,
        amount: body.amount,
        currency: body.currency,
        interval: body.interval,
        trialDays: body.trialDays,
        graceDays: body.graceDays,
        metadata: body.metadata,
        isActive: true,
      },
    });
  }

  @Put('prices/:id')
  @ApiOperation({ summary: 'Update a price' })
  async updatePrice(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { amount?: number; isActive?: boolean; metadata?: any },
  ) {
    const price = await this.prisma.price.findFirst({
      where: { id, product: { serviceId: req.user.serviceId } },
    });
    if (!price) throw new NotFoundException('Price not found');
    return this.prisma.price.update({ where: { id }, data: body });
  }

  @Delete('prices/:id')
  @ApiOperation({ summary: 'Delete a price' })
  async deletePrice(@Req() req: any, @Param('id') id: string) {
    const price = await this.prisma.price.findFirst({
      where: { id, product: { serviceId: req.user.serviceId } },
    });
    if (!price) throw new NotFoundException('Price not found');
    return this.prisma.price.delete({ where: { id } });
  }
}
