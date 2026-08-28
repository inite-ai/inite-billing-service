import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/services/prisma.service';
import { Conversation, ChatMessage } from '@prisma/client';

/** Who is asking — a platform user over a JWT, or a module over its API key. */
export interface ConversationCaller {
  userId: string;
  isService?: boolean;
  serviceId?: string;
}

@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The active conversation between this user and this service's assistant.
   *
   * Scoped by service, so two modules talking to the same user do not land in
   * one shared thread — and so the ownership check below has something to check.
   */
  async getOrCreate(
    userId: string,
    mode: string,
    serviceId: string | null = null,
  ): Promise<Conversation> {
    const existing = await this.prisma.conversation.findFirst({
      where: { userId, mode, status: 'active', serviceId },
      orderBy: { updatedAt: 'desc' },
    });

    if (existing) return existing;

    return this.prisma.conversation.create({
      data: { userId, mode, status: 'active', serviceId },
    });
  }

  /**
   * Load a conversation the caller is entitled to, or refuse.
   *
   * Every endpoint used to run this check only `if (!user.isService)`, so a
   * service key skipped it: any registered module could read, and write into,
   * any user's conversation on the platform. A service is now confined to the
   * conversations its own key created, and a user to their own.
   */
  async requireAccess(conversationId: string, caller: ConversationCaller): Promise<Conversation> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    // Same message either way: whether a conversation exists is not something
    // an unauthorised caller gets to learn.
    const denied = new ForbiddenException('You do not have access to this conversation');
    if (!conversation) throw denied;

    if (caller.isService) {
      if (!caller.serviceId || conversation.serviceId !== caller.serviceId) throw denied;
      return conversation;
    }

    if (conversation.userId !== caller.userId) throw denied;
    return conversation;
  }

  async getConversationById(id: string): Promise<Conversation | null> {
    return this.prisma.conversation.findUnique({
      where: { id },
    });
  }

  async addMessage(
    conversationId: string,
    role: string,
    content: string,
    toolCalls?: any,
    toolResults?: any,
  ): Promise<ChatMessage> {
    const message = await this.prisma.chatMessage.create({
      data: {
        conversationId,
        role,
        content,
        toolCalls: toolCalls ?? undefined,
        toolResults: toolResults ?? undefined,
      },
    });

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    return message;
  }

  async getMessages(conversationId: string, limit = 30): Promise<ChatMessage[]> {
    return this.prisma.chatMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  /**
   * A user sees every conversation they own, across services. A service sees
   * only the ones it started — including when it asks on a user's behalf.
   */
  async listConversations(userId: string, caller?: ConversationCaller): Promise<Conversation[]> {
    return this.prisma.conversation.findMany({
      where: caller?.isService ? { userId, serviceId: caller.serviceId ?? null } : { userId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async resolveConversation(
    conversationId: string,
    caller: ConversationCaller,
  ): Promise<Conversation> {
    await this.requireAccess(conversationId, caller);
    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: { status: 'resolved' },
    });
  }

  async setFeedback(
    conversationId: string,
    messageId: string,
    rating: 'up' | 'down' | null,
    comment?: string,
  ): Promise<ChatMessage> {
    const message = await this.prisma.chatMessage.findUnique({
      where: { id: messageId },
    });
    if (!message || message.conversationId !== conversationId) {
      throw new NotFoundException('Message not found in this conversation');
    }
    if (message.role !== 'assistant') {
      throw new BadRequestException('Feedback can only be left on assistant messages');
    }
    return this.prisma.chatMessage.update({
      where: { id: messageId },
      data: {
        feedback: rating,
        feedbackComment: rating ? (comment ?? null) : null,
        feedbackAt: rating ? new Date() : null,
      },
    });
  }
}
