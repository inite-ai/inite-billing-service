import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/services/prisma.service';
import { ProductResponseDto, PriceResponseDto } from '../common/dto/catalog.dto';
import { ProductType } from '@prisma/client';

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async getProducts(serviceId?: string): Promise<ProductResponseDto[]> {
    const where: any = { isActive: true };
    if (serviceId) where.serviceId = serviceId;

    const products = await this.prisma.product.findMany({
      where,
      include: { prices: { where: { isActive: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return products.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      serviceId: p.serviceId || undefined,
      moduleScope: p.moduleScope,
      type: p.type,
      isActive: p.isActive,
      metadata: p.metadata as Record<string, any> | undefined,
      prices: p.prices.map((pr) => ({
        id: pr.id,
        productId: pr.productId,
        code: pr.code,
        currency: pr.currency,
        amount: pr.amount.toString(),
        interval: pr.interval || undefined,
        trialDays: pr.trialDays || undefined,
        graceDays: pr.graceDays || undefined,
        isActive: pr.isActive,
      })),
    }));
  }

  async getPrices(productCode?: string, serviceId?: string): Promise<PriceResponseDto[]> {
    const where: any = { isActive: true };

    if (productCode) {
      const product = await this.prisma.product.findUnique({
        where: { code: productCode },
      });
      if (!product) {
        throw new NotFoundException(`Product not found: ${productCode}`);
      }
      where.productId = product.id;
    }

    if (serviceId) {
      where.product = { ...where.product, serviceId };
    }

    const prices = await this.prisma.price.findMany({
      where,
      include: { product: true },
      orderBy: { createdAt: 'desc' },
    });

    return prices.map((p) => ({
      id: p.id,
      productId: p.productId,
      code: p.code,
      currency: p.currency,
      amount: p.amount.toString(),
      interval: p.interval || undefined,
      trialDays: p.trialDays || undefined,
      graceDays: p.graceDays || undefined,
      isActive: p.isActive,
    }));
  }

  async getPriceByCode(code: string) {
    const price = await this.prisma.price.findUnique({
      where: { code },
      include: { product: true },
    });

    if (!price || !price.isActive) {
      throw new NotFoundException(`Price not found: ${code}`);
    }

    return price;
  }

  // ─── Service-scoped CRUD ─────────────────────────────────

  async getServiceProducts(serviceId: string) {
    return this.prisma.product.findMany({
      where: { serviceId },
      include: { prices: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createServiceProduct(
    serviceId: string,
    data: {
      code: string;
      name: string;
      type: ProductType;
      moduleScope?: string;
      metadata?: any;
    },
  ) {
    const existing = await this.prisma.product.findFirst({
      where: { code: data.code, serviceId },
    });
    if (existing) {
      throw new BadRequestException(`Product with code '${data.code}' already exists`);
    }
    return this.prisma.product.create({
      data: {
        ...data,
        moduleScope: data.moduleScope || 'default',
        serviceId,
      },
    });
  }

  async updateServiceProduct(
    serviceId: string,
    productId: string,
    data: { name?: string; isActive?: boolean; metadata?: any },
  ) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, serviceId },
    });
    if (!product) throw new NotFoundException('Product not found');
    return this.prisma.product.update({ where: { id: productId }, data });
  }

  async deleteServiceProduct(serviceId: string, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, serviceId },
    });
    if (!product) throw new NotFoundException('Product not found');
    return this.prisma.product.delete({ where: { id: productId } });
  }

  async getServicePrices(serviceId: string) {
    return this.prisma.price.findMany({
      where: { product: { serviceId } },
      include: { product: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createServicePrice(
    serviceId: string,
    data: {
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
    const product = await this.prisma.product.findFirst({
      where: { id: data.productId, serviceId },
    });
    if (!product) {
      throw new BadRequestException('Product not found or does not belong to this service');
    }
    return this.prisma.price.create({
      data: {
        code: data.code,
        productId: data.productId,
        amount: data.amount,
        currency: data.currency,
        interval: data.interval,
        trialDays: data.trialDays,
        graceDays: data.graceDays,
        metadata: data.metadata,
        isActive: true,
      },
    });
  }

  async updateServicePrice(
    serviceId: string,
    priceId: string,
    data: { amount?: number; isActive?: boolean; metadata?: any },
  ) {
    const price = await this.prisma.price.findFirst({
      where: { id: priceId, product: { serviceId } },
    });
    if (!price) throw new NotFoundException('Price not found');
    return this.prisma.price.update({ where: { id: priceId }, data });
  }

  async deleteServicePrice(serviceId: string, priceId: string) {
    const price = await this.prisma.price.findFirst({
      where: { id: priceId, product: { serviceId } },
    });
    if (!price) throw new NotFoundException('Price not found');
    return this.prisma.price.delete({ where: { id: priceId } });
  }
}
