import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/services/prisma.service';
import { toMoney } from '../common/money';
import { feeFor, readPolicy, tierPriceCode } from './commitment-policy';

/**
 * The prices of a stake offer, written from its policy: one price per tier,
 * `<product>-usd-<tier>`, amount = stake + fee. Prices of tiers the policy no
 * longer has are switched off. Run after changing the policy; creation refuses
 * a price that no longer matches it, so a fee can't change behind a quote.
 */
@Injectable()
export class CommitmentCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async sync(productCode: string) {
    const product = await this.prisma.product.findUnique({
      where: { code: productCode },
      include: { prices: true },
    });
    if (!product) throw new NotFoundException(`No product ${productCode}`);
    const policy = readPolicy(product.metadata);
    if (!policy) throw new BadRequestException(`${productCode} has no commitment policy`);
    if (product.type !== 'one_time' || !product.serviceId) {
      throw new BadRequestException('A stake offer is a one-time product of one service');
    }
    const codes = new Set<string>();
    const prices = [];
    for (const tier of policy.tiers) {
      const stake = toMoney(tier);
      const fee = feeFor(stake, policy.feePct);
      const code = tierPriceCode(product.code, tier);
      codes.add(code);
      const data = {
        currency: 'USD',
        amount: stake.plus(fee),
        isActive: true,
        metadata: { commitment: { stake: stake.toFixed(2), fee: fee.toFixed(2) } },
      };
      prices.push(
        await this.prisma.price.upsert({
          where: { code },
          create: { productId: product.id, code, ...data },
          update: data,
        }),
      );
    }
    const retired = await this.prisma.price.updateMany({
      where: { productId: product.id, code: { notIn: [...codes] }, isActive: true },
      data: { isActive: false },
    });
    return {
      productCode,
      prices: prices.map((p) => ({ code: p.code, amount: p.amount.toFixed(2) })),
      retired: retired.count,
    };
  }
}
