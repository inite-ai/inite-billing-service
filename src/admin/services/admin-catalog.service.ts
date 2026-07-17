import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../common/services/prisma.service';

@Injectable()
export class AdminCatalogService {
  private readonly logger = new Logger(AdminCatalogService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @InjectQueue('embeddings')
    private readonly embeddingsQueue?: Queue,
  ) {}

  /** Fire-and-forget: product CRUD must never fail because of embeddings. */
  private enqueueEmbedding(productId: string): void {
    void this.embeddingsQueue
      ?.add('embed-product', { productId })
      .catch((error: any) =>
        this.logger.warn(`Embedding enqueue failed: ${error.message}`),
      );
  }

  private generateApiKey(): string {
    return `sk_${randomBytes(24).toString('hex')}`;
  }

  private maskApiKey(apiKey: string): string {
    if (!apiKey || apiKey.length < 4) return '****';
    return `sk_****${apiKey.slice(-4)}`;
  }

  // ─── Services ──────────────────────────────────────────────

  async getServices() {
    const services = await this.prisma.service.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return services.map((s) => ({
      ...s,
      apiKey: this.maskApiKey(s.apiKey),
    }));
  }

  async createService(data: { code: string; name: string; metadata?: any }) {
    return this.prisma.service.create({
      data: {
        ...data,
        apiKey: this.generateApiKey(),
      },
    });
  }

  async updateService(
    id: string,
    data: { name?: string; isActive?: boolean; metadata?: any },
  ) {
    const service = await this.prisma.service.findUnique({ where: { id } });
    if (!service) throw new NotFoundException(`Service not found: ${id}`);
    return this.prisma.service.update({ where: { id }, data });
  }

  async revealServiceApiKey(id: string) {
    const service = await this.prisma.service.findUnique({ where: { id } });
    if (!service) throw new NotFoundException(`Service not found: ${id}`);
    return { apiKey: service.apiKey };
  }

  async regenerateServiceApiKey(id: string) {
    const service = await this.prisma.service.findUnique({ where: { id } });
    if (!service) throw new NotFoundException(`Service not found: ${id}`);
    return this.prisma.service.update({
      where: { id },
      data: { apiKey: this.generateApiKey() },
    });
  }

  async deleteService(id: string) {
    const service = await this.prisma.service.findUnique({ where: { id } });
    if (!service) throw new NotFoundException(`Service not found: ${id}`);
    return this.prisma.service.delete({ where: { id } });
  }

  // ─── Products ──────────────────────────────────────────────

  async getProducts(serviceId?: string) {
    const where: any = {};
    if (serviceId) where.serviceId = serviceId;

    return this.prisma.product.findMany({
      where,
      include: { prices: true, service: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createProduct(data: {
    code: string;
    name: string;
    serviceId?: string;
    moduleScope: string;
    type: any;
    metadata?: any;
  }) {
    const created = await this.prisma.product.create({ data });
    this.enqueueEmbedding(created.id);
    return created;
  }

  async updateProduct(
    id: string,
    data: {
      name?: string;
      serviceId?: string;
      moduleScope?: string;
      isActive?: boolean;
      metadata?: any;
    },
  ) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException(`Product not found: ${id}`);
    const updated = await this.prisma.product.update({ where: { id }, data });
    this.enqueueEmbedding(id);
    return updated;
  }

  async deleteProduct(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException(`Product not found: ${id}`);
    return this.prisma.product.delete({ where: { id } });
  }

  // ─── Prices ────────────────────────────────────────────────

  async getPrices(productId?: string) {
    const where: any = {};
    if (productId) where.productId = productId;

    return this.prisma.price.findMany({
      where,
      include: { product: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createPrice(data: {
    productId: string;
    code: string;
    currency: string;
    amount: number;
    interval?: string;
    trialDays?: number;
    graceDays?: number;
    metadata?: any;
  }) {
    return this.prisma.price.create({ data });
  }

  async updatePrice(
    id: string,
    data: {
      amount?: number;
      isActive?: boolean;
      trialDays?: number;
      graceDays?: number;
      metadata?: any;
    },
  ) {
    const price = await this.prisma.price.findUnique({ where: { id } });
    if (!price) throw new NotFoundException(`Price not found: ${id}`);
    return this.prisma.price.update({ where: { id }, data });
  }

  async deletePrice(id: string) {
    const price = await this.prisma.price.findUnique({ where: { id } });
    if (!price) throw new NotFoundException(`Price not found: ${id}`);
    return this.prisma.price.delete({ where: { id } });
  }
}
