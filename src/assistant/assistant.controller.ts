import { Controller, Post, Body, Res, UseGuards, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User, RequestUser } from '../auth/decorators/user.decorator';
import { AssistantService } from './assistant.service';
import {
  sse,
  sseDone,
  UI_MESSAGE_STREAM_HEADER,
  UI_MESSAGE_STREAM_VERSION,
} from './stream-protocol';

@ApiTags('Assistant')
@Controller('v1/assistant')
@UseGuards(JwtAuthGuard)
@Throttle({ default: { limit: 10, ttl: 60000 } })
export class AssistantController {
  private readonly logger = new Logger(AssistantController.name);

  constructor(private readonly assistantService: AssistantService) {}

  @Post('generate-features')
  @ApiOperation({ summary: 'Generate product features with AI' })
  async generateFeatures(
    @Body()
    body: {
      name: string;
      type: string;
      description?: string;
      creditsPerPeriod?: number;
      locale?: string;
    },
  ) {
    return this.assistantService.generateProductFeatures(body);
  }

  @Post('chat')
  @ApiOperation({ summary: 'Chat with AI assistant (SSE streaming)' })
  async chat(
    @User() user: RequestUser,
    @Res() res: Response,
    @Body() body: { message: string; conversationId?: string },
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader(UI_MESSAGE_STREAM_HEADER, UI_MESSAGE_STREAM_VERSION);

    try {
      for await (const chunk of this.assistantService.chat(
        user.userId,
        body.message,
        body.conversationId,
        user.roles || [],
      )) {
        res.write(chunk);
      }
    } catch (error: any) {
      this.logger.error(`Chat error: ${error.message}`, error.stack);
      // The [DONE] terminator is mandatory even on errors, or useChat hangs
      res.write(
        sse({
          type: 'error',
          errorText: 'An error occurred processing your request.',
        }),
      );
      res.write(sseDone());
    }

    res.end();
  }
}
