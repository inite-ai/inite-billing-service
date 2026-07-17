import { Controller, Get, Param, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
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
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get order by ID' })
  @ApiResponse({ status: 200, type: OrderResponseDto })
  async getOrder(@User() user: RequestUser, @Param('id') id: string): Promise<OrderResponseDto> {
    return this.ordersService.getOrderById(id, user.userId);
  }
}
