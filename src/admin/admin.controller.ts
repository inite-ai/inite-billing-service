import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AdminService } from './admin.service';
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
    private readonly adminService: AdminService,
    private readonly referralLevelsService: ReferralLevelsService,
    private readonly promoCodesService: PromoCodesService,
    private readonly funnelService: FunnelService,
    private readonly creditsService: CreditsService,
  ) {}

  // ─── Services ──────────────────────────────────────────────

  @Get('services')
  @ApiOperation({ summary: 'List all services' })
  async getServices() {
    return this.adminService.getServices();
  }

  @Post('services')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a service' })
  async createService(
    @Body() body: { code: string; name: string; metadata?: any },
  ) {
    return this.adminService.createService(body);
  }

  @Put('services/:id')
  @ApiOperation({ summary: 'Update a service' })
  async updateService(
    @Param('id') id: string,
    @Body() body: { name?: string; isActive?: boolean; metadata?: any },
  ) {
    return this.adminService.updateService(id, body);
  }

  @Get('services/:id/reveal-key')
  @ApiOperation({ summary: 'Get full (unmasked) API key for a service' })
  async revealServiceApiKey(@Param('id') id: string) {
    return this.adminService.revealServiceApiKey(id);
  }

  @Post('services/:id/regenerate-key')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Regenerate API key for a service' })
  async regenerateServiceApiKey(@Param('id') id: string) {
    return this.adminService.regenerateServiceApiKey(id);
  }

  @Delete('services/:id')
  @ApiOperation({ summary: 'Delete a service' })
  async deleteService(@Param('id') id: string) {
    return this.adminService.deleteService(id);
  }

  // ─── Products ──────────────────────────────────────────────

  @Get('products')
  @ApiOperation({ summary: 'List all products' })
  async getProducts(@Query('serviceId') serviceId?: string) {
    return this.adminService.getProducts(serviceId);
  }

  @Post('products')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a product' })
  async createProduct(
    @Body()
    body: {
      code: string;
      name: string;
      serviceId?: string;
      moduleScope: string;
      type: string;
      metadata?: any;
    },
  ) {
    return this.adminService.createProduct(body);
  }

  @Put('products/:id')
  @ApiOperation({ summary: 'Update a product' })
  async updateProduct(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      serviceId?: string;
      moduleScope?: string;
      isActive?: boolean;
      metadata?: any;
    },
  ) {
    return this.adminService.updateProduct(id, body);
  }

  @Delete('products/:id')
  @ApiOperation({ summary: 'Delete a product' })
  async deleteProduct(@Param('id') id: string) {
    return this.adminService.deleteProduct(id);
  }

  // ─── Prices ────────────────────────────────────────────────

  @Get('prices')
  @ApiOperation({ summary: 'List all prices' })
  async getPrices(@Query('productId') productId?: string) {
    return this.adminService.getPrices(productId);
  }

  @Post('prices')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a price' })
  async createPrice(
    @Body()
    body: {
      productId: string;
      code: string;
      currency: string;
      amount: number;
      interval?: string;
      trialDays?: number;
      graceDays?: number;
      metadata?: any;
    },
  ) {
    return this.adminService.createPrice(body);
  }

  @Put('prices/:id')
  @ApiOperation({ summary: 'Update a price' })
  async updatePrice(
    @Param('id') id: string,
    @Body()
    body: {
      amount?: number;
      isActive?: boolean;
      trialDays?: number;
      graceDays?: number;
      metadata?: any;
    },
  ) {
    return this.adminService.updatePrice(id, body);
  }

  @Delete('prices/:id')
  @ApiOperation({ summary: 'Delete a price' })
  async deletePrice(@Param('id') id: string) {
    return this.adminService.deletePrice(id);
  }

  // ─── Customers ────────────────────────────────────────────

  @Get('customers')
  @ApiOperation({ summary: 'List all customers (aggregated from orders)' })
  async getCustomers(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.adminService.getCustomers({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      search: search || undefined,
    });
  }

  @Get('customers/:userId')
  @ApiOperation({ summary: 'Get customer detail' })
  async getCustomerDetail(@Param('userId') userId: string) {
    return this.adminService.getCustomerDetail(userId);
  }

  // ─── Orders ────────────────────────────────────────────────

  @Get('orders')
  @ApiOperation({ summary: 'List all orders' })
  async getOrders(
    @Query('status') status?: string,
    @Query('userId') userId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.getOrders({
      status,
      userId,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('orders/:id')
  @ApiOperation({ summary: 'Get order details' })
  async getOrderById(@Param('id') id: string) {
    return this.adminService.getOrderById(id);
  }

  @Post('orders/:id/refund')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refund an order' })
  async refundOrder(@Param('id') id: string) {
    return this.adminService.refundOrder(id);
  }

  // ─── Subscriptions ────────────────────────────────────────

  @Get('subscriptions')
  @ApiOperation({ summary: 'List all subscriptions' })
  async getSubscriptions(
    @Query('status') status?: string,
    @Query('userId') userId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.getSubscriptions({
      status,
      userId,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Post('subscriptions/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Force cancel a subscription' })
  async cancelSubscription(@Param('id') id: string) {
    return this.adminService.cancelSubscription(id);
  }

  // ─── Entitlements ──────────────────────────────────────────

  @Get('entitlements')
  @ApiOperation({ summary: 'List all entitlements' })
  async getEntitlements(
    @Query('userId') userId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.getEntitlements({
      userId,
      status,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Post('entitlements')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an entitlement manually' })
  async createEntitlement(
    @Body() body: { userId: string; key: string; value?: any; expiresAt?: string },
  ) {
    return this.adminService.createEntitlement(body);
  }

  @Put('entitlements/:id')
  @ApiOperation({ summary: 'Update an entitlement' })
  async updateEntitlement(
    @Param('id') id: string,
    @Body() body: { key?: string; value?: any; expiresAt?: string },
  ) {
    return this.adminService.updateEntitlement(id, body);
  }

  @Post('entitlements/:id/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke an entitlement' })
  async revokeEntitlement(@Param('id') id: string) {
    return this.adminService.revokeEntitlement(id);
  }

  // ─── Affiliates ────────────────────────────────────────────

  @Get('affiliates')
  @ApiOperation({ summary: 'List all affiliates' })
  async getAffiliates(
    @Query('status') status?: string,
    @Query('serviceId') serviceId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.getAffiliates({
      status,
      serviceId,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Put('affiliates/:id')
  @ApiOperation({ summary: 'Update an affiliate' })
  async updateAffiliate(
    @Param('id') id: string,
    @Body() body: { status?: string; commissionRate?: number },
  ) {
    return this.adminService.updateAffiliate(id, body);
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
  async createReferralLevel(
    @Body()
    body: {
      serviceId: string;
      level: number;
      commissionRate: number;
      name: string;
    },
  ) {
    return this.referralLevelsService.createLevel(body);
  }

  @Put('referral-levels/:id')
  @ApiOperation({ summary: 'Update a referral level' })
  async updateReferralLevel(
    @Param('id') id: string,
    @Body() body: { commissionRate?: number; name?: string; isActive?: boolean },
  ) {
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
  async applyReferralTemplate(
    @Body() body: { serviceId: string; templateKey: string },
  ) {
    return this.referralLevelsService.applyTemplate(body.serviceId, body.templateKey);
  }

  // ─── Payouts ───────────────────────────────────────────────

  @Get('payouts')
  @ApiOperation({ summary: 'List all payouts' })
  async getPayouts(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.getPayouts({
      status,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Post('payouts/:id/process')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Process a payout' })
  async processPayout(@Param('id') id: string) {
    return this.adminService.processPayout(id);
  }

  @Post('payouts/:id/fail')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark payout as failed' })
  async failPayout(
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.adminService.failPayout(id, body?.reason);
  }

  // ─── Payout Providers ──────────────────────────────────────

  @Get('payout-providers')
  @ApiOperation({ summary: 'List all payout providers' })
  async getPayoutProviders() {
    return this.adminService.getPayoutProviders();
  }

  @Post('payout-providers')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a payout provider' })
  async createPayoutProvider(
    @Body() body: { code: string; name: string; currencies?: string[]; minAmount?: number; maxAmount?: number; feePercent?: number; feeFixed?: number; config?: any; metadata?: any },
  ) {
    return this.adminService.createPayoutProvider(body);
  }

  @Put('payout-providers/:id')
  @ApiOperation({ summary: 'Update a payout provider' })
  async updatePayoutProvider(
    @Param('id') id: string,
    @Body() body: { name?: string; isActive?: boolean; currencies?: string[]; minAmount?: number; maxAmount?: number; feePercent?: number; feeFixed?: number; config?: any; metadata?: any },
  ) {
    return this.adminService.updatePayoutProvider(id, body);
  }

  @Delete('payout-providers/:id')
  @ApiOperation({ summary: 'Delete a payout provider' })
  async deletePayoutProvider(@Param('id') id: string) {
    return this.adminService.deletePayoutProvider(id);
  }

  // ─── Payment Providers ──────────────────────────────────────

  @Get('payment-providers')
  @ApiOperation({ summary: 'List all payment providers' })
  async getPaymentProviders() {
    return this.adminService.getPaymentProviders();
  }

  @Post('payment-providers')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a payment provider' })
  async createPaymentProvider(
    @Body() body: {
      code: string;
      name: string;
      isActive?: boolean;
      supportedModes?: string[];
      currencies?: string[];
      countries?: string[];
      webhookUrl?: string;
      config?: any;
      metadata?: any;
    },
  ) {
    return this.adminService.createPaymentProvider(body);
  }

  @Put('payment-providers/:id')
  @ApiOperation({ summary: 'Update a payment provider' })
  async updatePaymentProvider(
    @Param('id') id: string,
    @Body() body: {
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
    return this.adminService.updatePaymentProvider(id, body);
  }

  @Delete('payment-providers/:id')
  @ApiOperation({ summary: 'Delete a payment provider' })
  async deletePaymentProvider(@Param('id') id: string) {
    return this.adminService.deletePaymentProvider(id);
  }

  // ─── Webhooks ──────────────────────────────────────────────

  @Get('webhooks')
  @ApiOperation({ summary: 'List webhook events' })
  async getWebhooks(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.getWebhooks({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
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
  async createPromoCode(
    @Body()
    body: {
      code: string;
      name: string;
      description?: string;
      discountType: string;
      discountValue: number;
      serviceId?: string;
      minPurchaseAmount?: number;
      maxDiscountAmount?: number;
      validFrom: string;
      validUntil?: string;
      isActive?: boolean;
      maxUsageCount?: number;
      maxUsagePerUser?: number;
      stackWithReferral?: boolean;
      metadata?: any;
    },
  ) {
    return this.promoCodesService.create(body);
  }

  @Put('promo-codes/:id')
  @ApiOperation({ summary: 'Update a promo code' })
  async updatePromoCode(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      description?: string;
      discountType?: string;
      discountValue?: number;
      serviceId?: string;
      minPurchaseAmount?: number;
      maxDiscountAmount?: number;
      validFrom?: string;
      validUntil?: string;
      isActive?: boolean;
      maxUsageCount?: number;
      maxUsagePerUser?: number;
      stackWithReferral?: boolean;
      metadata?: any;
    },
  ) {
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
  async getFunnelPipeline(
    @Query('serviceId') serviceId?: string,
  ) {
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
  async getAbandonedCheckouts(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
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
  async adjustCredits(
    @Body()
    body: {
      userId: string;
      serviceId?: string;
      amount: number;
      description: string;
    },
  ) {
    return this.creditsService.adminAdjust(body);
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

  // ─── Stats ─────────────────────────────────────────────────

  @Get('stats')
  @ApiOperation({ summary: 'Get overall statistics' })
  async getStats() {
    return this.adminService.getStats();
  }
}
