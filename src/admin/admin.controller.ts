import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CreatePromoCodeDto, UpdatePromoCodeDto } from './dto/create-promo-code.dto';
import { CreateReferralLevelDto, UpdateReferralLevelDto } from './dto/referral-level.dto';
import { CreatePriceDto, UpdatePriceDto } from './dto/price.dto';
import { CreateServiceDto, UpdateServiceDto } from './dto/service.dto';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';
import { CreateEntitlementDto, UpdateEntitlementDto } from './dto/entitlement.dto';
import {
  CreatePaymentProviderDto,
  CreatePayoutProviderDto,
  UpdatePaymentProviderDto,
  UpdatePayoutProviderDto,
} from './dto/provider.dto';
import {
  ApplyReferralTemplateDto,
  FailPayoutDto,
  UpdateAffiliateDto,
} from './dto/affiliate-admin.dto';
import { AdminAdjustCreditsDto } from './dto/credits-admin.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AdminCatalogService } from './services/admin-catalog.service';
import { AdminOrdersService } from './services/admin-orders.service';
import { AdminUsersService } from './services/admin-users.service';
import { AdminAffiliatesService } from './services/admin-affiliates.service';
import { AdminProvidersService } from './services/admin-providers.service';
import { AdminStatsService } from './services/admin-stats.service';
import {
  AdminExportService,
  EXPORT_RESOURCES,
  ExportResource,
} from './services/admin-export.service';
import { ReferralLevelsService } from '../affiliates/referral-levels.service';
import { PromoCodesService } from '../promo-codes/promo-codes.service';
import { FunnelService } from '../funnel/funnel.service';
import { CreditsService } from '../credits/credits.service';

@ApiTags('Admin')
@Controller('v1/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminController {
  constructor(
    private readonly catalogService: AdminCatalogService,
    private readonly ordersService: AdminOrdersService,
    private readonly usersService: AdminUsersService,
    private readonly affiliatesService: AdminAffiliatesService,
    private readonly providersService: AdminProvidersService,
    private readonly statsService: AdminStatsService,
    private readonly exportService: AdminExportService,
    private readonly referralLevelsService: ReferralLevelsService,
    private readonly promoCodesService: PromoCodesService,
    private readonly funnelService: FunnelService,
    private readonly creditsService: CreditsService,
  ) {}

  // ─── Services ──────────────────────────────────────────────

  @Get('services')
  @ApiOperation({ summary: 'List all services' })
  async getServices() {
    return this.catalogService.getServices();
  }

  @Post('services')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a service' })
  async createService(@Body() body: CreateServiceDto) {
    return this.catalogService.createService(body);
  }

  @Put('services/:id')
  @ApiOperation({ summary: 'Update a service' })
  async updateService(@Param('id') id: string, @Body() body: UpdateServiceDto) {
    return this.catalogService.updateService(id, body);
  }

  @Get('services/:id/reveal-key')
  @ApiOperation({ summary: 'Get full (unmasked) API key for a service' })
  async revealServiceApiKey(@Param('id') id: string) {
    return this.catalogService.revealServiceApiKey(id);
  }

  @Post('services/:id/regenerate-key')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Regenerate API key for a service' })
  async regenerateServiceApiKey(@Param('id') id: string) {
    return this.catalogService.regenerateServiceApiKey(id);
  }

  @Delete('services/:id')
  @ApiOperation({ summary: 'Delete a service' })
  async deleteService(@Param('id') id: string) {
    return this.catalogService.deleteService(id);
  }

  // ─── Products ──────────────────────────────────────────────

  @Get('products')
  @ApiOperation({ summary: 'List all products' })
  async getProducts(@Query('serviceId') serviceId?: string) {
    return this.catalogService.getProducts(serviceId);
  }

  @Post('products')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a product' })
  async createProduct(@Body() body: CreateProductDto) {
    return this.catalogService.createProduct(body);
  }

  @Put('products/:id')
  @ApiOperation({ summary: 'Update a product' })
  async updateProduct(@Param('id') id: string, @Body() body: UpdateProductDto) {
    return this.catalogService.updateProduct(id, body);
  }

  @Delete('products/:id')
  @ApiOperation({ summary: 'Delete a product' })
  async deleteProduct(@Param('id') id: string) {
    return this.catalogService.deleteProduct(id);
  }

  // ─── Prices ────────────────────────────────────────────────

  @Get('prices')
  @ApiOperation({ summary: 'List all prices' })
  async getPrices(@Query('productId') productId?: string) {
    return this.catalogService.getPrices(productId);
  }

  @Post('prices')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a price' })
  async createPrice(@Body() body: CreatePriceDto) {
    return this.catalogService.createPrice(body);
  }

  @Put('prices/:id')
  @ApiOperation({ summary: 'Update a price' })
  async updatePrice(@Param('id') id: string, @Body() body: UpdatePriceDto) {
    return this.catalogService.updatePrice(id, body);
  }

  @Delete('prices/:id')
  @ApiOperation({ summary: 'Delete a price' })
  async deletePrice(@Param('id') id: string) {
    return this.catalogService.deletePrice(id);
  }

  // ─── Customers ────────────────────────────────────────────

  @Get('customers')
  @ApiOperation({ summary: 'List all customers (aggregated from orders)' })
  async getCustomers(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
  ) {
    return this.usersService.getCustomers({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      search: search || undefined,
      sortBy,
      sortOrder,
    });
  }

  @Get('customers/:userId')
  @ApiOperation({ summary: 'Get customer detail' })
  async getCustomerDetail(@Param('userId') userId: string) {
    return this.usersService.getCustomerDetail(userId);
  }

  // ─── Orders ────────────────────────────────────────────────

  @Get('orders')
  @ApiOperation({ summary: 'List all orders' })
  async getOrders(
    @Query('status') status?: string,
    @Query('userId') userId?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
  ) {
    return this.ordersService.getOrders({
      status,
      userId,
      search,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      sortBy,
      sortOrder,
    });
  }

  @Get('orders/:id')
  @ApiOperation({ summary: 'Get order details' })
  async getOrderById(@Param('id') id: string) {
    return this.ordersService.getOrderById(id);
  }

  @Post('orders/:id/refund')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refund an order' })
  async refundOrder(@Param('id') id: string) {
    return this.ordersService.refundOrder(id);
  }

  // ─── Subscriptions ────────────────────────────────────────

  @Get('subscriptions')
  @ApiOperation({ summary: 'List all subscriptions' })
  async getSubscriptions(
    @Query('status') status?: string,
    @Query('userId') userId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
  ) {
    return this.ordersService.getSubscriptions({
      status,
      userId,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      sortBy,
      sortOrder,
    });
  }

  @Post('subscriptions/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Force cancel a subscription' })
  async cancelSubscription(@Param('id') id: string) {
    return this.ordersService.cancelSubscription(id);
  }

  // ─── Entitlements ──────────────────────────────────────────

  @Get('entitlements')
  @ApiOperation({ summary: 'List all entitlements' })
  async getEntitlements(
    @Query('userId') userId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
  ) {
    return this.usersService.getEntitlements({
      userId,
      status,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      sortBy,
      sortOrder,
    });
  }

  @Post('entitlements')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an entitlement manually' })
  async createEntitlement(@Body() body: CreateEntitlementDto) {
    return this.usersService.createEntitlement(body);
  }

  @Put('entitlements/:id')
  @ApiOperation({ summary: 'Update an entitlement' })
  async updateEntitlement(@Param('id') id: string, @Body() body: UpdateEntitlementDto) {
    return this.usersService.updateEntitlement(id, body);
  }

  @Post('entitlements/:id/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke an entitlement' })
  async revokeEntitlement(@Param('id') id: string) {
    return this.usersService.revokeEntitlement(id);
  }

  // ─── Affiliates ────────────────────────────────────────────

  @Get('affiliates')
  @ApiOperation({ summary: 'List all affiliates' })
  async getAffiliates(
    @Query('status') status?: string,
    @Query('serviceId') serviceId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
  ) {
    return this.affiliatesService.getAffiliates({
      status,
      serviceId,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      sortBy,
      sortOrder,
    });
  }

  @Put('affiliates/:id')
  @ApiOperation({ summary: 'Update an affiliate' })
  async updateAffiliate(@Param('id') id: string, @Body() body: UpdateAffiliateDto) {
    return this.affiliatesService.updateAffiliate(id, body);
  }

  // ─── Referral Levels ───────────────────────────────────────

  @Get('referral-levels')
  @ApiOperation({ summary: 'List all referral levels' })
  async getReferralLevels(@Query('serviceId') serviceId?: string) {
    return this.referralLevelsService.getAllLevels(serviceId);
  }

  @Post('referral-levels')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a referral level' })
  async createReferralLevel(@Body() body: CreateReferralLevelDto) {
    return this.referralLevelsService.createLevel(body);
  }

  @Put('referral-levels/:id')
  @ApiOperation({ summary: 'Update a referral level' })
  async updateReferralLevel(@Param('id') id: string, @Body() body: UpdateReferralLevelDto) {
    return this.referralLevelsService.updateLevel(id, body);
  }

  @Delete('referral-levels/:id')
  @ApiOperation({ summary: 'Delete a referral level' })
  async deleteReferralLevel(@Param('id') id: string) {
    return this.referralLevelsService.deleteLevel(id);
  }

  @Get('referral-templates')
  @ApiOperation({ summary: 'List available referral level templates' })
  async getReferralTemplates() {
    return this.referralLevelsService.getTemplates();
  }

  @Post('referral-templates/apply')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Apply a referral template to a service' })
  async applyReferralTemplate(@Body() body: ApplyReferralTemplateDto) {
    return this.referralLevelsService.applyTemplate(body.serviceId, body.templateKey);
  }

  // ─── Payouts ───────────────────────────────────────────────

  @Get('payouts')
  @ApiOperation({ summary: 'List all payouts' })
  async getPayouts(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
  ) {
    return this.affiliatesService.getPayouts({
      status,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      sortBy,
      sortOrder,
    });
  }

  @Post('payouts/:id/process')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Process a payout' })
  async processPayout(@Param('id') id: string) {
    return this.affiliatesService.processPayout(id);
  }

  @Post('payouts/:id/fail')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark payout as failed' })
  async failPayout(@Param('id') id: string, @Body() body: FailPayoutDto) {
    return this.affiliatesService.failPayout(id, body?.reason);
  }

  // ─── Payout Providers ──────────────────────────────────────

  @Get('payout-providers')
  @ApiOperation({ summary: 'List all payout providers' })
  async getPayoutProviders() {
    return this.providersService.getPayoutProviders();
  }

  @Post('payout-providers')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a payout provider' })
  async createPayoutProvider(@Body() body: CreatePayoutProviderDto) {
    return this.providersService.createPayoutProvider(body);
  }

  @Put('payout-providers/:id')
  @ApiOperation({ summary: 'Update a payout provider' })
  async updatePayoutProvider(@Param('id') id: string, @Body() body: UpdatePayoutProviderDto) {
    return this.providersService.updatePayoutProvider(id, body);
  }

  @Delete('payout-providers/:id')
  @ApiOperation({ summary: 'Delete a payout provider' })
  async deletePayoutProvider(@Param('id') id: string) {
    return this.providersService.deletePayoutProvider(id);
  }

  // ─── Payment Providers ──────────────────────────────────────

  @Get('payment-providers')
  @ApiOperation({ summary: 'List all payment providers' })
  async getPaymentProviders() {
    return this.providersService.getPaymentProviders();
  }

  @Post('payment-providers')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a payment provider' })
  async createPaymentProvider(@Body() body: CreatePaymentProviderDto) {
    return this.providersService.createPaymentProvider(body);
  }

  @Put('payment-providers/:id')
  @ApiOperation({ summary: 'Update a payment provider' })
  async updatePaymentProvider(@Param('id') id: string, @Body() body: UpdatePaymentProviderDto) {
    return this.providersService.updatePaymentProvider(id, body);
  }

  @Delete('payment-providers/:id')
  @ApiOperation({ summary: 'Delete a payment provider' })
  async deletePaymentProvider(@Param('id') id: string) {
    return this.providersService.deletePaymentProvider(id);
  }

  // ─── Webhooks ──────────────────────────────────────────────

  @Get('webhooks')
  @ApiOperation({ summary: 'List webhook events' })
  async getWebhooks(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
  ) {
    return this.statsService.getWebhooks({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      status,
      sortBy,
      sortOrder,
    });
  }

  // ─── Promo Codes ──────────────────────────────────────────

  @Get('promo-codes')
  @ApiOperation({ summary: 'List all promo codes' })
  async getPromoCodes(
    @Query('serviceId') serviceId?: string,
    @Query('isActive') isActive?: string,
  ) {
    return this.promoCodesService.findAll({
      serviceId,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
    });
  }

  @Post('promo-codes')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a promo code' })
  async createPromoCode(@Body() body: CreatePromoCodeDto) {
    return this.promoCodesService.create(body);
  }

  @Put('promo-codes/:id')
  @ApiOperation({ summary: 'Update a promo code' })
  async updatePromoCode(@Param('id') id: string, @Body() body: UpdatePromoCodeDto) {
    return this.promoCodesService.update(id, body);
  }

  @Delete('promo-codes/:id')
  @ApiOperation({ summary: 'Delete a promo code' })
  async deletePromoCode(@Param('id') id: string) {
    return this.promoCodesService.delete(id);
  }

  @Get('promo-codes/:id/usage')
  @ApiOperation({ summary: 'Get promo code usage stats' })
  async getPromoCodeUsage(@Param('id') id: string) {
    return this.promoCodesService.getUsageStats(id);
  }

  // ─── Funnel / CJM ────────────────────────────────────────────

  @Get('funnel/pipeline')
  @ApiOperation({ summary: 'Get funnel pipeline data for kanban view' })
  async getFunnelPipeline(@Query('serviceId') serviceId?: string) {
    return this.funnelService.getPipelineData(serviceId);
  }

  @Get('funnel/metrics')
  @ApiOperation({ summary: 'Get funnel metrics' })
  async getFunnelMetrics(
    @Query('serviceId') serviceId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.funnelService.getFunnelMetrics({
      serviceId,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });
  }

  @Get('funnel/timeseries')
  @ApiOperation({ summary: 'Get funnel time series breakdown' })
  async getFunnelTimeSeries(
    @Query('serviceId') serviceId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('granularity') granularity?: string,
  ) {
    return this.funnelService.getFunnelTimeSeries({
      serviceId,
      from: from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      to: to ? new Date(to) : new Date(),
      granularity: (granularity as 'day' | 'week' | 'month') || 'day',
    });
  }

  @Get('funnel/user/:userId')
  @ApiOperation({ summary: 'Get user journey timeline' })
  async getUserJourney(@Param('userId') userId: string) {
    return this.funnelService.getUserJourney(userId);
  }

  @Get('funnel/abandoned')
  @ApiOperation({ summary: 'Get abandoned checkouts' })
  async getAbandonedCheckouts(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.funnelService.getAbandonedCheckouts({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  // ─── Credits ────────────────────────────────────────────────

  @Get('credits')
  @ApiOperation({ summary: 'List all credit balances with filters' })
  async getCreditBalances(
    @Query('userId') userId?: string,
    @Query('serviceId') serviceId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.creditsService.listBalances({
      userId,
      serviceId,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Post('credits/adjust')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Manual credit adjustment' })
  async adjustCredits(@Body() body: AdminAdjustCreditsDto) {
    // The ledger row should always carry a justification; the operator's own
    // wording when they gave one.
    return this.creditsService.adminAdjust({
      ...body,
      description: body.description || 'admin adjustment',
    });
  }

  @Get('credits/:userId/usage')
  @ApiOperation({ summary: 'Get user credit usage history' })
  async getUserCreditUsage(
    @Param('userId') userId: string,
    @Query('serviceId') serviceId?: string,
    @Query('type') type?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.creditsService.getUsageHistory(userId, {
      serviceId,
      type,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  // ─── Export ────────────────────────────────────────────────

  /**
   * One route for every exportable list. The filters and sort are the list's
   * own, so the file matches the screen the operator pressed the button on;
   * anything larger than the row cap is refused with a message rather than
   * quietly truncated into a file that looks complete.
   */
  @Get('export/:resource')
  @ApiOperation({
    summary: 'Export a list as CSV (orders, subscriptions, payouts, affiliates, customers)',
  })
  async exportCsv(
    @Param('resource') resource: string,
    @Res() res: Response,
    @Query('status') status?: string,
    @Query('userId') userId?: string,
    @Query('serviceId') serviceId?: string,
    @Query('search') search?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
  ) {
    if (!EXPORT_RESOURCES.includes(resource as ExportResource)) {
      throw new BadRequestException(
        `Unknown export resource "${resource}". Expected one of: ${EXPORT_RESOURCES.join(', ')}`,
      );
    }

    const { filename, csv, rows } = await this.exportService.toCsvFile(resource as ExportResource, {
      status,
      userId,
      serviceId,
      search,
      sortBy,
      sortOrder,
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    // Read by the UI to tell the operator how many rows they just downloaded.
    res.setHeader('X-Export-Rows', String(rows));
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Export-Rows');
    res.send(csv);
  }

  // ─── Stats ─────────────────────────────────────────────────

  @Get('stats')
  @ApiOperation({ summary: 'Get overall statistics' })
  async getStats() {
    return this.statsService.getStats();
  }
}
