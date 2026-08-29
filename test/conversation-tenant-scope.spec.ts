import { ForbiddenException } from '@nestjs/common';
import { ConversationsService } from '../src/conversations/conversations.service';
import { ConversationsController } from '../src/conversations/conversations.controller';

/**
 * Conversations belong to one service.
 *
 * Every endpoint ran its ownership check inside `if (!user.isService)`, and the
 * message endpoints scoped by nothing at all — so any registered module could
 * read any user's support chat (order ids, amounts, entitlements, whatever the
 * customer typed), enumerate their conversations by user id, and post messages
 * into them with an arbitrary role.
 */
describe('conversation tenant scoping', () => {
  const conversation = (overrides: any = {}) => ({
    id: 'conv-1',
    userId: 'user-1',
    mode: 'user',
    status: 'active',
    serviceId: 'svc-a',
    ...overrides,
  });

  const build = (row: any) => {
    const prisma: any = {
      conversation: {
        findUnique: jest.fn().mockResolvedValue(row),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }: any) => ({ id: 'new', ...data })),
        update: jest.fn().mockResolvedValue(row),
      },
      chatMessage: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new ConversationsService(prisma);
    return { prisma, service, controller: new ConversationsController(service) };
  };

  const serviceCaller = (serviceId: string) => ({
    userId: `service:${serviceId}`,
    isService: true,
    serviceId,
    roles: [],
  });

  describe('requireAccess', () => {
    it('refuses a service reading another service’s conversation', async () => {
      const { service } = build(conversation({ serviceId: 'svc-a' }));
      await expect(service.requireAccess('conv-1', serviceCaller('svc-b'))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('allows the service that owns it', async () => {
      const { service } = build(conversation({ serviceId: 'svc-a' }));
      await expect(service.requireAccess('conv-1', serviceCaller('svc-a'))).resolves.toMatchObject({
        id: 'conv-1',
      });
    });

    it('keeps unattributed conversations away from every service key', async () => {
      // Created before conversations had an owner. The user still reaches them
      // over a JWT; adopting them on first touch would let whichever service
      // asked first claim a conversation it never had.
      const { service } = build(conversation({ serviceId: null }));
      await expect(service.requireAccess('conv-1', serviceCaller('svc-a'))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(
        service.requireAccess('conv-1', { userId: 'user-1', roles: [] } as any),
      ).resolves.toMatchObject({ id: 'conv-1' });
    });

    it('still refuses one user another user’s conversation', async () => {
      const { service } = build(conversation({ userId: 'user-1' }));
      await expect(
        service.requireAccess('conv-1', { userId: 'user-2', roles: [] } as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('does not say whether a conversation exists', async () => {
      const { service } = build(null);
      await expect(service.requireAccess('conv-missing', serviceCaller('svc-a'))).rejects.toThrow(
        'You do not have access to this conversation',
      );
    });
  });

  describe('endpoints', () => {
    it('blocks reading another service’s messages', async () => {
      const { controller } = build(conversation({ serviceId: 'svc-a' }));
      await expect(
        controller.getMessages(serviceCaller('svc-b') as any, 'conv-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('blocks posting an assistant message into another service’s conversation', async () => {
      const { controller, prisma } = build(conversation({ serviceId: 'svc-a' }));
      await expect(
        controller.addMessage(serviceCaller('svc-b') as any, 'conv-1', {
          role: 'assistant',
          content: 'your card was declined, click here',
        } as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.chatMessage.create).not.toHaveBeenCalled();
    });

    it('stamps the calling service on a conversation it creates', async () => {
      const { controller, prisma } = build(null);
      await controller.getOrCreate(serviceCaller('svc-a') as any, { userId: 'user-1' } as any);
      expect(prisma.conversation.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', mode: 'user', status: 'active', serviceId: 'svc-a' },
      });
    });

    it('lists only the calling service’s conversations', async () => {
      const { controller, prisma } = build(null);
      await controller.listConversations(serviceCaller('svc-a') as any, 'user-1');
      expect(prisma.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1', serviceId: 'svc-a' } }),
      );
    });

    it('lets a user see their own conversations across services', async () => {
      const { controller, prisma } = build(null);
      await controller.listConversations({ userId: 'user-1', roles: [] } as any);
      expect(prisma.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1' } }),
      );
    });
  });
});
