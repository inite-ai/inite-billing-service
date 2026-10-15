import {
  Controller,
  Get,
  Post,
  Body,
  BadRequestException,
  Param,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtOrServiceGuard } from '../auth/guards/jwt-or-service.guard';
import { ServiceAuthGuard } from '../auth/guards/service-auth.guard';
import { User, RequestUser } from '../auth/decorators/user.decorator';
import { OrdersService } from './orders.service';
import {
  GetOrdersQueryDto,
  OrderResponseDto,
  PaymentIntentResponseDto,
} from '../common/dto/order.dto';

@ApiTags('Orders')
@Controller('v1/orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get current user orders' })
  @ApiResponse({ status: 200, type: [OrderResponseDto] })
  async getMyOrders(
    @User() user: RequestUser,
    @Query() query: GetOrdersQueryDto,
  ): Promise<OrderResponseDto[]> {
    return this.ordersService.getUserOrders(user.userId, query.status);
  }

  @Post('me/claim-guest-purchases')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Take over the guest orders a store opened for this user’s verified email',
  })
  async claimGuestPurchases(@User() user: RequestUser): Promise<{ claimed: string[] }> {
    return this.ordersService.claimGuestPurchases(user.userId, user.email, user.emailVerified);
  }

  @Post('claim-guest-purchases')
  @UseGuards(ServiceAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'A service moves its own guest orders to a user it signed in with a verified email',
    description:
      'For a store that signs its users in itself (neuralcosmology.com): it has verified the email with the identity provider and passes it along with the user id. Only orders for the calling service’s products move.',
  })
  async claimGuestPurchasesForUser(
    @Req() req: any,
    @Body() body: { userId?: string; email?: string },
  ): Promise<{ claimed: string[] }> {
    const userId = typeof body?.userId === 'string' ? body.userId : '';
    const email = typeof body?.email === 'string' ? body.email : '';
    if (!userId.startsWith('did:') || !email) {
      throw new BadRequestException('userId (an INITE DID) and email are required');
    }
    return this.ordersService.claimGuestPurchases(userId, email, true, req.user.serviceId);
  }

  @Get('payment-intents/:id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get payment intent by ID' })
  @ApiResponse({ status: 200, type: PaymentIntentResponseDto })
  async getPaymentIntent(
    @User() user: RequestUser,
    @Param('id') id: string,
  ): Promise<PaymentIntentResponseDto> {
    return this.ordersService.getPaymentIntentById(id, user.userId);
  }

  @Get(':id')
  @UseGuards(JwtOrServiceGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get order by ID',
    description:
      "A user sees their own order; a service API key sees orders for its own service's products.",
  })
  @ApiResponse({ status: 200, type: OrderResponseDto })
  async getOrder(@Req() req: any, @Param('id') id: string): Promise<OrderResponseDto> {
    // A service selling to guests reconciles by order id, and the order's
    // user may have changed at checkout (a guest order claimed by the buyer's
    // account). Without the service path this answered 401 to every key.
    if (req.user?.isService) {
      return this.ordersService.getOrderById(id, undefined, req.user.serviceId);
    }
    return this.ordersService.getOrderById(id, req.user?.userId);
  }
}
