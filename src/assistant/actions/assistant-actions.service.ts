import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/services/prisma.service';
import { AnthropicConfigService } from '../../common/anthropic/anthropic-config.service';
import { ConversationsService } from '../../conversations/conversations.service';
import { RequestUser } from '../../auth/decorators/user.decorator';
import { ActionRegistryService, ActionContext } from './action-registry';

const EXECUTING_STALE_MS = 5 * 60 * 1000;

@Injectable()
export class AssistantActionsService {
  private readonly logger = new Logger(AssistantActionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ActionRegistryService,
    private readonly anthropicConfig: AnthropicConfigService,
    private readonly conversationsService: ConversationsService,
  ) {}

  private logAiEvent(event: Record<string, unknown>): void {
    this.logger.log(JSON.stringify({ ts: new Date().toISOString(), ...event }));
  }

  async propose(input: {
    toolName: string;
    rawParams: any;
    conversationId: string;
    userId: string;
    toolUseId?: string;
  }) {
    const def = this.registry.get(input.toolName);
    if (!def) {
      throw new NotFoundException(`Unknown action: ${input.toolName}`);
    }
    const ctx: ActionContext = { userId: input.userId };
    const params = await def.validate(input.rawParams, ctx);
    const summary = def.summarize(params);
    const expiresAt = new Date(
      Date.now() + this.anthropicConfig.actionTtlMinutes * 60 * 1000,
    );

    const action = await this.prisma.assistantAction.create({
      data: {
        conversationId: input.conversationId,
        userId: input.userId,
        toolName: input.toolName,
        toolUseId: input.toolUseId ?? null,
        params,
        summary,
        requiredRole: def.scope === 'admin' ? 'admin' : null,
        status: 'pending',
        expiresAt,
      },
    });

    this.logAiEvent({
      event: 'assistant_action_proposed',
      actionId: action.id,
      toolName: action.toolName,
      userId: input.userId,
    });

    return action;
  }

  async confirm(actionId: string, user: RequestUser) {
    const action = await this.loadOwned(actionId, user);

    // Roles are re-checked from the fresh JWT at confirm time, not the proposal
    if (action.requiredRole && !(user.roles || []).includes(action.requiredRole)) {
      throw new ForbiddenException(
        `Confirming this action requires the ${action.requiredRole} role`,
      );
    }

    await this.expireIfStale(action);

    const startedAt = Date.now();
    // Idempotency/race gate: only one confirm can win the pending -> executing CAS
    const claimed = await this.prisma.assistantAction.updateMany({
      where: {
        id: actionId,
        status: 'pending',
        expiresAt: { gt: new Date() },
      },
      data: {
        status: 'executing',
        confirmedAt: new Date(),
        confirmedBy: user.userId,
      },
    });

    if (claimed.count === 0) {
      const current = await this.prisma.assistantAction.findUnique({
        where: { id: actionId },
      });
      throw new ConflictException({
        message: `Action is ${current?.status ?? 'unavailable'}`,
        status: current?.status,
      });
    }

    const def = this.registry.get(action.toolName);
    let updated;
    try {
      if (!def) {
        throw new Error(`Action definition missing: ${action.toolName}`);
      }
      const result = await def.execute(action.params as Record<string, any>, {
        userId: action.userId,
        approverId: user.userId,
      });
      updated = await this.prisma.assistantAction.update({
        where: { id: actionId },
        data: {
          status: 'executed',
          result: result ?? {},
          executedAt: new Date(),
        },
      });
    } catch (error: any) {
      // Failure is a domain outcome, not a transport error (HTTP 200 with failed row)
      updated = await this.prisma.assistantAction.update({
        where: { id: actionId },
        data: {
          status: 'failed',
          error: String(error.message).slice(0, 1000),
        },
      });
    }

    await this.appendOutcomeMessage(updated);

    this.logAiEvent({
      event: 'assistant_action',
      actionId,
      toolName: action.toolName,
      status: updated.status,
      durationMs: Date.now() - startedAt,
      approvedBy: user.userId,
    });

    return updated;
  }

  async reject(actionId: string, user: RequestUser) {
    const action = await this.loadOwned(actionId, user);
    await this.expireIfStale(action);

    const rejected = await this.prisma.assistantAction.updateMany({
      where: { id: actionId, status: 'pending' },
      data: { status: 'rejected' },
    });
    if (rejected.count === 0) {
      const current = await this.prisma.assistantAction.findUnique({
        where: { id: actionId },
      });
      throw new ConflictException({
        message: `Action is ${current?.status ?? 'unavailable'}`,
        status: current?.status,
      });
    }

    const updated = await this.prisma.assistantAction.findUnique({
      where: { id: actionId },
    });
    await this.appendOutcomeMessage(updated);
    return updated;
  }

  async listForUser(
    user: RequestUser,
    filters: { conversationId?: string; status?: string } = {},
  ) {
    const actions = await this.prisma.assistantAction.findMany({
      where: {
        userId: user.userId,
        ...(filters.conversationId
          ? { conversationId: filters.conversationId }
          : {}),
        ...(filters.status ? { status: filters.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    // Reflect lazy expiry in the response without extra writes
    const now = Date.now();
    return actions.map((a) =>
      a.status === 'pending' && a.expiresAt.getTime() <= now
        ? { ...a, status: 'expired' }
        : a.status === 'executing' &&
            a.updatedAt.getTime() <= now - EXECUTING_STALE_MS
          ? { ...a, status: 'failed' }
          : a,
    );
  }

  private async loadOwned(actionId: string, user: RequestUser) {
    const action = await this.prisma.assistantAction.findUnique({
      where: { id: actionId },
    });
    if (!action) {
      throw new NotFoundException('Action not found');
    }
    if (action.userId !== user.userId) {
      throw new ForbiddenException('You do not have access to this action');
    }
    return action;
  }

  private async expireIfStale(action: {
    id: string;
    status: string;
    expiresAt: Date;
  }): Promise<void> {
    if (action.status === 'pending' && action.expiresAt.getTime() <= Date.now()) {
      await this.prisma.assistantAction.updateMany({
        where: { id: action.id, status: 'pending' },
        data: { status: 'expired' },
      });
      throw new ConflictException({
        message: 'Action has expired',
        status: 'expired',
      });
    }
  }

  /** Append the outcome to the conversation so the next model turn knows it. */
  private async appendOutcomeMessage(action: any): Promise<void> {
    if (!action) return;
    try {
      await this.conversationsService.addMessage(
        action.conversationId,
        'tool',
        JSON.stringify({
          action: action.toolName,
          status: action.status,
          summary: action.summary,
          ...(action.result ? { result: action.result } : {}),
          ...(action.error ? { error: action.error } : {}),
        }),
      );
    } catch (error: any) {
      this.logger.warn(
        `Failed to append action outcome to conversation: ${error.message}`,
      );
    }
  }
}
