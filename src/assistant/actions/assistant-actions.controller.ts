import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { User, RequestUser } from '../../auth/decorators/user.decorator';
import { AssistantActionsService } from './assistant-actions.service';

@ApiTags('Assistant')
@Controller('v1/assistant/actions')
@UseGuards(JwtAuthGuard)
export class AssistantActionsController {
  constructor(private readonly actionsService: AssistantActionsService) {}

  @Get()
  @ApiOperation({ summary: 'List my assistant action proposals' })
  async list(
    @User() user: RequestUser,
    @Query('conversationId') conversationId?: string,
    @Query('status') status?: string,
  ) {
    return this.actionsService.listForUser(user, { conversationId, status });
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm and execute a proposed action' })
  async confirm(@User() user: RequestUser, @Param('id') id: string) {
    return this.actionsService.confirm(id, user);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a proposed action' })
  async reject(@User() user: RequestUser, @Param('id') id: string) {
    return this.actionsService.reject(id, user);
  }
}
