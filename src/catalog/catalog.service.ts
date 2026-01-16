import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/services/prisma.service';
import { ProductResponseDto, PriceResponseDto } from '../common/dto/catalog.dto';

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async getProducts(): Promise<ProductResponseDto[]> {
    const products = await this.prisma.product.findMany({
      where: {
        isActive: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return products.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      moduleScope: p.moduleScope,
      type: p.type,
      isActive: p.isActive,
      metadata: p.metadata as Record<string, any> | undefined,
    }));
  }

  async getPrices(productCode?: string): Promise<PriceResponseDto[]> {
    const where: any = {
      isActive: true,
    };

    if (productCode) {
      const product = await this.prisma.product.findUnique({
        where: { code: productCode },
      });
      if (!product) {
        throw new NotFoundException(`Product not found: ${productCode}`);
      }
      where.productId = product.id;
    }

    const prices = await this.prisma.price.findMany({
      where,
      include: {
        product: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
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

