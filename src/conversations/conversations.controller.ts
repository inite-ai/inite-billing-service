import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtOrServiceGuard } from '../auth/guards/jwt-or-service.guard';
import { User, RequestUser } from '../auth/decorators/user.decorator';
import { ConversationsService } from './conversations.service';

@ApiTags('Conversations')
@Controller('v1/conversations')
@UseGuards(JwtOrServiceGuard)
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get or create active conversation' })
  async getOrCreate(
    @User() user: RequestUser,
    @Body() body: { mode?: string; userId?: string },
  ) {
    const userId = user.isService && body.userId ? body.userId : user.userId;
    const mode = body.mode || 'user';
    return this.conversationsService.getOrCreate(userId, mode);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List user conversations' })
  async listConversations(
    @User() user: RequestUser,
    @Query('userId') queryUserId?: string,
  ) {
    const userId = user.isService && queryUserId ? queryUserId : user.userId;
    return this.conversationsService.listConversations(userId);
  }

  @Post(':id/messages')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a message to conversation' })
  async addMessage(
    @User() user: RequestUser,
    @Param('id') conversationId: string,
    @Body() body: { role: string; content: string; toolCalls?: any; toolResults?: any },
  ) {
    return this.conversationsService.addMessage(
      conversationId,
      body.role,
      body.content,
      body.toolCalls,
      body.toolResults,
    );
  }

  @Get(':id/messages')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get conversation messages' })
  async getMessages(
    @Param('id') conversationId: string,
    @Query('limit') limit?: string,
  ) {
    return this.conversationsService.getMessages(
      conversationId,
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resolve (close) a conversation' })
  async resolveConversation(
    @User() user: RequestUser,
    @Param('id') conversationId: string,
  ) {
    return this.conversationsService.resolveConversation(conversationId, user.userId);
  }
}
