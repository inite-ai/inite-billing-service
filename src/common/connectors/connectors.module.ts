import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { PrismaService } from '../services/prisma.service';
import { ConnectorRegistry } from './connector-registry.service';

/**
 * Provides the {@link ConnectorRegistry}. DiscoveryModule gives it access to the
 * app container so it can auto-discover `@RegisterConnector()` adapters wherever
 * they are declared (AdaptersModule) — no static wiring here.
 */
@Module({
  imports: [DiscoveryModule],
  providers: [PrismaService, ConnectorRegistry],
  exports: [ConnectorRegistry],
})
export class ConnectorsModule {}
