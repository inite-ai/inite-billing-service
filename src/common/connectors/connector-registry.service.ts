import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { PrismaService } from '../services/prisma.service';
import { Connector, connectorRailOf } from './connector.interface';
import { isVirtualRail } from './rail';

/**
 * Discovers every `@RegisterConnector()`-marked adapter in the app container at
 * boot (via Nest's DiscoveryService) and indexes it by canonical rail id. This
 * replaces the hand-maintained registration lists (main.ts, adapters.module)
 * with a single self-registering plugin surface.
 *
 * At startup it also cross-checks the registry against active PaymentProviders
 * so a misconfigured `code` (the exact drift that broke Apple/Google) is loud in
 * the logs instead of silently returning "adapter not found" at charge time.
 */
@Injectable()
export class ConnectorRegistry implements OnModuleInit {
  private readonly logger = new Logger(ConnectorRegistry.name);
  private readonly connectors = new Map<string, Connector>();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.discover();
    await this.validateAgainstProviders();
  }

  private discover(): void {
    for (const wrapper of this.discovery.getProviders()) {
      const rail = connectorRailOf(wrapper.metatype);
      if (!rail) continue;
      const instance = wrapper.instance as Connector | undefined;
      if (!instance || typeof instance.rail !== 'function') continue;

      // The class metadata and the runtime rail() must agree — a mismatch means
      // the decorator and the implementation disagree, which is a bug.
      const declared = instance.rail();
      if (declared !== rail) {
        this.logger.error(
          `Connector ${wrapper.name} declares @RegisterConnector('${rail}') but rail() returns '${declared}' — using rail()`,
        );
      }
      if (this.connectors.has(declared)) {
        this.logger.warn(
          `Duplicate connector for rail '${declared}' — keeping the first registered`,
        );
        continue;
      }
      this.connectors.set(declared, instance);
    }
    this.logger.log(`Discovered ${this.connectors.size} connectors: ${this.rails().join(', ')}`);
  }

  /** Assert every active provider's code maps to a registered connector. */
  private async validateAgainstProviders(): Promise<void> {
    let providers: Array<{ code: string }> = [];
    try {
      providers = await this.prisma.paymentProvider.findMany({
        where: { isActive: true },
        select: { code: true },
      });
    } catch (error: any) {
      // Never let a startup DB hiccup take billing down; discovery already ran.
      this.logger.warn(`Connector↔provider validation skipped (DB not ready): ${error.message}`);
      return;
    }

    for (const { code } of providers) {
      if (isVirtualRail(code)) continue;
      if (!this.connectors.has(code)) {
        this.logger.error(
          `Active PaymentProvider code '${code}' has NO registered connector — checkouts/webhooks on this rail will fail`,
        );
      }
    }
  }

  /** Register a connector explicitly (tests, or a runtime-provided adapter). */
  register(connector: Connector): void {
    this.connectors.set(connector.rail(), connector);
  }

  get(rail: string): Connector | undefined {
    return this.connectors.get(rail);
  }

  has(rail: string): boolean {
    return this.connectors.has(rail);
  }

  all(): Connector[] {
    return [...this.connectors.values()];
  }

  rails(): string[] {
    return [...this.connectors.keys()];
  }
}
