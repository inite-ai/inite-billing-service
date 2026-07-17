import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User, RequestUser } from '../auth/decorators/user.decorator';
import { NotificationsService } from './notifications.service';
import { MarkReadDto, SetPreferenceDto, UnsubscribeDto } from './dto/notifications.dto';

@ApiTags('Notifications')
@Controller('v1/notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List my in-app notifications' })
  async listMine(
    @User() user: RequestUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('unreadOnly') unreadOnly?: string,
  ) {
    return this.notificationsService.listForUser(user.userId, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      unreadOnly: unreadOnly === 'true',
    });
  }

  @Get('me/unread-count')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get my unread notification count' })
  async unreadCount(@User() user: RequestUser) {
    return { unreadCount: await this.notificationsService.unreadCount(user.userId) };
  }

  @Post('me/read')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark my notifications as read' })
  async markRead(@User() user: RequestUser, @Body() body: MarkReadDto) {
    return this.notificationsService.markRead(user.userId, body);
  }

  @Get('me/preferences')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get my notification preferences' })
  async getPreferences(@User() user: RequestUser) {
    return this.notificationsService.getPreferences(user.userId);
  }

  @Put('me/preferences')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Update a notification preference' })
  async setPreference(@User() user: RequestUser, @Body() body: SetPreferenceDto) {
    return this.notificationsService.setPreference(user.userId, body);
  }

  // Public endpoint (unsubscribe links from emails); global throttler applies
  @Post('unsubscribe')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unsubscribe from emails by token' })
  async unsubscribe(@Body() body: UnsubscribeDto) {
    return this.notificationsService.unsubscribeByToken(body.token, body.category);
  }
}
