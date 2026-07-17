import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/services/prisma.service';
import { Conversation, ChatMessage } from '@prisma/client';

@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreate(userId: string, mode: string): Promise<Conversation> {
    const existing = await this.prisma.conversation.findFirst({
      where: { userId, mode, status: 'active' },
      orderBy: { updatedAt: 'desc' },
    });

    if (existing) return existing;

    return this.prisma.conversation.create({
      data: { userId, mode, status: 'active' },
    });
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

  async listConversations(userId: string): Promise<Conversation[]> {
    return this.prisma.conversation.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async resolveConversation(conversationId: string, userId: string): Promise<Conversation> {
    return this.prisma.conversation.update({
      where: { id: conversationId, userId },
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
