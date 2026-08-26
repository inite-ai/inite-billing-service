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
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { JwtOrServiceGuard } from '../auth/guards/jwt-or-service.guard';
import { User, RequestUser } from '../auth/decorators/user.decorator';
import { ConversationsService } from './conversations.service';
import { publicApiValidation } from '../common/pipes/public-api-validation.pipe';
import { AddMessageDto, GetOrCreateConversationDto, SetFeedbackDto } from './dto/conversations.dto';

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
    @Body(publicApiValidation()) body: GetOrCreateConversationDto,
  ) {
    const userId = user.isService && body.userId ? body.userId : user.userId;
    const mode = body.mode || 'user';
    return this.conversationsService.getOrCreate(userId, mode);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List user conversations' })
  async listConversations(@User() user: RequestUser, @Query('userId') queryUserId?: string) {
    const userId = user.isService && queryUserId ? queryUserId : user.userId;
    return this.conversationsService.listConversations(userId);
  }

  @Post(':id/messages')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a message to conversation' })
  async addMessage(
    @User() user: RequestUser,
    @Param('id') conversationId: string,
    @Body(publicApiValidation()) body: AddMessageDto,
  ) {
    // H1 fix: Verify conversation ownership
    if (!user.isService) {
      const conversation = await this.conversationsService.getConversationById(conversationId);
      if (!conversation) {
        throw new ForbiddenException('Conversation not found');
      }
      if (conversation.userId !== user.userId) {
        throw new ForbiddenException('You do not have access to this conversation');
      }
    }

    // M7 fix: Non-service callers can only send user messages
    const role = user.isService ? body.role : 'user';

    return this.conversationsService.addMessage(
      conversationId,
      role,
      body.content,
      body.toolCalls,
      body.toolResults,
    );
  }

  @Get(':id/messages')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get conversation messages' })
  async getMessages(
    @User() user: RequestUser,
    @Param('id') conversationId: string,
    @Query('limit') limit?: string,
  ) {
    // H1 fix: Verify conversation ownership
    if (!user.isService) {
      const conversation = await this.conversationsService.getConversationById(conversationId);
      if (!conversation) {
        throw new ForbiddenException('Conversation not found');
      }
      if (conversation.userId !== user.userId) {
        throw new ForbiddenException('You do not have access to this conversation');
      }
    }

    return this.conversationsService.getMessages(
      conversationId,
      limit ? Math.min(parseInt(limit, 10), 100) : undefined,
    );
  }

  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resolve (close) a conversation' })
  async resolveConversation(@User() user: RequestUser, @Param('id') conversationId: string) {
    return this.conversationsService.resolveConversation(conversationId, user.userId);
  }

  @Post(':id/messages/:messageId/feedback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Leave feedback on an assistant message' })
  async setFeedback(
    @User() user: RequestUser,
    @Param('id') conversationId: string,
    @Param('messageId') messageId: string,
    @Body(publicApiValidation()) body: SetFeedbackDto,
  ) {
    // H1 fix: Verify conversation ownership
    if (!user.isService) {
      const conversation = await this.conversationsService.getConversationById(conversationId);
      if (!conversation) {
        throw new ForbiddenException('Conversation not found');
      }
      if (conversation.userId !== user.userId) {
        throw new ForbiddenException('You do not have access to this conversation');
      }
    }

    if (body.rating !== 'up' && body.rating !== 'down' && body.rating !== null) {
      throw new ForbiddenException('rating must be "up", "down" or null');
    }

    return this.conversationsService.setFeedback(
      conversationId,
      messageId,
      body.rating,
      typeof body.comment === 'string' ? body.comment.slice(0, 1000) : undefined,
    );
  }
}
