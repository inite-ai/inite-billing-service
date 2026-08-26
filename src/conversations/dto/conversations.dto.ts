import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/** Body for POST /v1/conversations. `userId` is honoured for service callers only. */
export class GetOrCreateConversationDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  mode?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;
}

/**
 * Body for POST /v1/conversations/:id/messages. `content` is bounded because it
 * is persisted and later replayed into a model context.
 */
export class AddMessageDto {
  @IsIn(['user', 'assistant', 'system', 'tool'])
  role!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100_000)
  content!: string;

  @IsOptional()
  toolCalls?: any;

  @IsOptional()
  toolResults?: any;
}

/** Body for POST /v1/conversations/:id/messages/:messageId/feedback. */
export class SetFeedbackDto {
  @IsOptional()
  @IsIn(['up', 'down', null])
  rating?: 'up' | 'down' | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}
