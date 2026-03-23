import { Injectable } from '@nestjs/common';
import { AdminCatalogService } from './services/admin-catalog.service';
import { AdminOrdersService } from './services/admin-orders.service';
import { AdminUsersService } from './services/admin-users.service';
import { AdminAffiliatesService } from './services/admin-affiliates.service';
import { AdminProvidersService } from './services/admin-providers.service';
import { AdminStatsService } from './services/admin-stats.service';

/**
 * Thin facade that delegates to domain-specific admin services.
 * Kept for backward compatibility — prefer injecting the split services directly.
 */
@Injectable()
export class AdminService {
  constructor(
    public readonly catalog: AdminCatalogService,
    public readonly orders: AdminOrdersService,
    public readonly users: AdminUsersService,
    public readonly affiliates: AdminAffiliatesService,
    public readonly providers: AdminProvidersService,
    public readonly stats: AdminStatsService,
  ) {}
}
