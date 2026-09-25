import { Module } from '@nestjs/common';
import { McpController } from './mcp.controller';
import { McpToolsService } from './mcp-tools.service';
import { McpProxyController } from './mcp-proxy.controller';
import { McpProxyService } from './mcp-proxy.service';
import { McpServersController } from './mcp-servers.controller';
import { McpServersService } from './mcp-servers.service';
import { McpAdminController } from './mcp-admin.controller';
import { PrismaService } from '../common/services/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { CreditsModule } from '../credits/credits.module';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { CatalogModule } from '../catalog/catalog.module';
import { CheckoutModule } from '../checkout/checkout.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

/**
 * The MCP surface over this service.
 *
 * It owns no data and no business rules: every tool is a thin call into the
 * module that already implements it, so an agent and an HTTP client get the
 * same answers, the same tenant scoping and the same ledger.
 */
@Module({
  imports: [
    AuthModule,
    CreditsModule,
    EntitlementsModule,
    CatalogModule,
    CheckoutModule,
    SubscriptionsModule,
  ],
  controllers: [McpController, McpProxyController, McpServersController, McpAdminController],
  providers: [McpToolsService, McpProxyService, McpServersService, PrismaService],
  exports: [McpToolsService, McpProxyService, McpServersService],
})
export class McpModule {}
