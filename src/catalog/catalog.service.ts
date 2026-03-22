import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/services/prisma.service';
import { ProductResponseDto, PriceResponseDto } from '../common/dto/catalog.dto';

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
}
