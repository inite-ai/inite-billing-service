import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/services/prisma.service';

/**
 * A provider's `config` holds its live credentials — the Stripe secret key, the
 * webhook signing secret, the payout API token. Those used to be serialised
 * into every admin list response and sent to the browser, where they sat in
 * memory, in the devtools network tab, in any screen share, and within reach of
 * anything that ever manages to run script on the page. Nothing on the client
 * needed them: the UI only ever showed which keys were set.
 *
 * What goes out instead is the shape of the config — which keys exist, and the
 * last four characters of each so an operator can tell one key from another.
 */
function redactConfig(config: unknown): {
  configuredKeys: string[];
  configPreview: Record<string, string>;
} {
  if (!config || typeof config !== 'object') return { configuredKeys: [], configPreview: {} };

  const preview: Record<string, string> = {};
  for (const [key, value] of Object.entries(config as Record<string, unknown>)) {
    const text = value == null ? '' : String(value);
    preview[key] = text.length > 4 ? `••••${text.slice(-4)}` : text ? '••••' : '';
  }
  return { configuredKeys: Object.keys(preview), configPreview: preview };
}

function withoutSecrets<T extends { config?: unknown }>(provider: T) {
  const { config, ...rest } = provider;
  return { ...rest, ...redactConfig(config) };
}

/**
 * Merge a submitted config over the stored one instead of replacing it.
 *
 * The admin UI used to do this merge in the browser, which only worked because
 * the browser had been handed the secrets to merge with. Doing it here means a
 * form that submits just the API key keeps the signing secret it never saw. A
 * key submitted as `null` is removed — the only way to delete one.
 */
function mergeConfig(stored: unknown, patch: unknown): Record<string, unknown> | undefined {
  if (patch === undefined) return undefined;
  const base =
    stored && typeof stored === 'object' ? { ...(stored as Record<string, unknown>) } : {};
  if (!patch || typeof patch !== 'object') return base;

  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === null) delete base[key];
    else base[key] = value;
  }
  return base;
}

@Injectable()
export class AdminProvidersService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Payment Providers ──────────────────────────────────────

  async getPaymentProviders() {
    const providers = await this.prisma.paymentProvider.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return providers.map(withoutSecrets);
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
    const created = await this.prisma.paymentProvider.create({ data: data as any });
    return withoutSecrets(created);
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
    const updated = await this.prisma.paymentProvider.update({
      where: { id },
      data: { ...data, config: mergeConfig(provider.config, data.config) } as any,
    });
    return withoutSecrets(updated);
  }

  async deletePaymentProvider(id: string) {
    const provider = await this.prisma.paymentProvider.findUnique({ where: { id } });
    if (!provider) throw new NotFoundException(`Payment provider not found: ${id}`);
    const deleted = await this.prisma.paymentProvider.delete({ where: { id } });
    return withoutSecrets(deleted);
  }

  // ─── Payout Providers ──────────────────────────────────────

  async getPayoutProviders() {
    const providers = await this.prisma.payoutProvider.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return providers.map(withoutSecrets);
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
    const created = await this.prisma.payoutProvider.create({ data });
    return withoutSecrets(created);
  }

  async updatePayoutProvider(
    id: string,
    data: {
      name?: string;
      isActive?: boolean;
      currencies?: string[];
      minAmount?: number;
      maxAmount?: number;
      feePercent?: number;
      feeFixed?: number;
      config?: any;
      metadata?: any;
    },
  ) {
    const provider = await this.prisma.payoutProvider.findUnique({ where: { id } });
    if (!provider) throw new NotFoundException(`Payout provider not found: ${id}`);
    const updated = await this.prisma.payoutProvider.update({
      where: { id },
      data: { ...data, config: mergeConfig(provider.config, data.config) } as any,
    });
    return withoutSecrets(updated);
  }

  async deletePayoutProvider(id: string) {
    const provider = await this.prisma.payoutProvider.findUnique({ where: { id } });
    if (!provider) throw new NotFoundException(`Payout provider not found: ${id}`);
    const deleted = await this.prisma.payoutProvider.delete({ where: { id } });
    return withoutSecrets(deleted);
  }
}
