import {
  Controller,
  Get,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtOrServiceGuard } from '../auth/guards/jwt-or-service.guard';
import { User, RequestUser } from '../auth/decorators/user.decorator';
import { EntitlementsService } from './entitlements.service';
import { EntitlementResponseDto } from '../common/dto/entitlement.dto';

@ApiTags('Entitlements')
@Controller('v1/entitlements')
export class EntitlementsController {
  constructor(private readonly entitlementsService: EntitlementsService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get current user entitlements' })
  @ApiResponse({ status: 200, type: [EntitlementResponseDto] })
  async getMyEntitlements(@User() user: RequestUser): Promise<EntitlementResponseDto[]> {
    return this.entitlementsService.getUserEntitlements(user.userId);
  }

  @Get(':userId')
  @UseGuards(JwtOrServiceGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get user entitlements (admin/service)' })
  @ApiResponse({ status: 200, type: [EntitlementResponseDto] })
  async getUserEntitlements(
    @User() user: RequestUser,
    @Param('userId') userId: string,
  ): Promise<EntitlementResponseDto[]> {
    if (!user.isService && user.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }
    // A service caller only sees entitlements owned by its own service; a user
    // caller (already ownership-checked above) sees all of theirs.
    return this.entitlementsService.getUserEntitlementsByUserId(
      userId,
      user.isService ? user.serviceId : undefined,
    );
  }
}
