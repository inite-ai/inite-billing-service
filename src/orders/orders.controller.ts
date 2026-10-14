import {
  Controller,
  Get,
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
