import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtOrServiceGuard } from '../auth/guards/jwt-or-service.guard';
import { User, RequestUser } from '../auth/decorators/user.decorator';
import { PrismaService } from '../common/services/prisma.service';
import { RecommendationsService } from './recommendations.service';

@ApiTags('Recommendations')
@Controller('v1/recommendations')
export class RecommendationsController {
  constructor(
    private readonly recommendationsService: RecommendationsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Next-best-offer recommendations for the current user' })
  async forMe(
    @User() user: RequestUser,
    @Query('surface') surface?: string,
    @Query('limit') limit?: string,
    @Query('explain') explain?: string,
    @Query('locale') locale?: string,
  ) {
    return this.recommendationsService.getNextBestOffers(user.userId, {
      surface: surface === 'checkout' ? 'checkout' : 'dashboard',
      limit: limit ? parseInt(limit, 10) : undefined,
      explain: explain === 'true',
      locale,
    });
  }

  @Get('checkout/:sessionId')
  @UseGuards(JwtOrServiceGuard)
  @ApiOperation({ summary: 'Session-relative recommendations for a checkout' })
  async forCheckout(
    @User() user: RequestUser,
    @Param('sessionId') sessionId: string,
    @Query('limit') limit?: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: sessionId },
      include: { price: { select: { productId: true } } },
    });
    if (!order) throw new NotFoundException('Checkout session not found');
    if (!user.isService && order.userId !== user.userId) {
      throw new ForbiddenException('You do not have access to this session');
    }
    return this.recommendationsService.getNextBestOffers(order.userId, {
      surface: 'checkout',
      sessionProductId: order.price?.productId ?? undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  // C4 pattern: platform modules only
  @Get(':userId')
  @UseGuards(JwtOrServiceGuard)
  @ApiOperation({ summary: 'Recommendations for a user (service-to-service)' })
  async forUser(@User() user: RequestUser, @Param('userId') userId: string) {
    if (!user.isService && userId !== user.userId) {
      throw new ForbiddenException('You can only access your own recommendations');
    }
    return this.recommendationsService.getNextBestOffers(userId, {
      surface: 'dashboard',
    });
  }
}
