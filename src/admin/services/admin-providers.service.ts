import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/services/prisma.service';

@Injectable()
export class AdminProvidersService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Payment Providers ──────────────────────────────────────

  async getPaymentProviders() {
    return this.prisma.paymentProvider.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async createPaymentProvider(data: {
    code: string;
    name: string;
    isActive?: boolean;
    supportedModes?: string[];
    currencies?: string[];
    countries?: string[];
    webhookUrl?: string;
    config?: any;
    metadata?: any;
  }) {
    return this.prisma.paymentProvider.create({ data: data as any });
  }

  async updatePaymentProvider(
    id: string,
    data: {
      name?: string;
      isActive?: boolean;
      supportedModes?: string[];
      currencies?: string[];
      countries?: string[];
      webhookUrl?: string;
      config?: any;
      metadata?: any;
    },
  ) {
    const provider = await this.prisma.paymentProvider.findUnique({ where: { id } });
    if (!provider) throw new NotFoundException(`Payment provider not found: ${id}`);
    return this.prisma.paymentProvider.update({ where: { id }, data: data as any });
  }

  async deletePaymentProvider(id: string) {
    const provider = await this.prisma.paymentProvider.findUnique({ where: { id } });
    if (!provider) throw new NotFoundException(`Payment provider not found: ${id}`);
    return this.prisma.paymentProvider.delete({ where: { id } });
  }

  // ─── Payout Providers ──────────────────────────────────────

  async getPayoutProviders() {
    return this.prisma.payoutProvider.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async createPayoutProvider(data: {
    code: string;
    name: string;
    currencies?: string[];
    minAmount?: number;
    maxAmount?: number;
    feePercent?: number;
    feeFixed?: number;
    config?: any;
    metadata?: any;
  }) {
    return this.prisma.payoutProvider.create({ data });
  }

  async updatePayoutProvider(
    id: string,
    data: { name?: string; isActive?: boolean; currencies?: string[]; minAmount?: number; maxAmount?: number; feePercent?: number; feeFixed?: number; config?: any; metadata?: any },
  ) {
    const provider = await this.prisma.payoutProvider.findUnique({ where: { id } });
    if (!provider) throw new NotFoundException(`Payout provider not found: ${id}`);
    return this.prisma.payoutProvider.update({ where: { id }, data });
  }

  async deletePayoutProvider(id: string) {
    const provider = await this.prisma.payoutProvider.findUnique({ where: { id } });
    if (!provider) throw new NotFoundException(`Payout provider not found: ${id}`);
    return this.prisma.payoutProvider.delete({ where: { id } });
  }
}
