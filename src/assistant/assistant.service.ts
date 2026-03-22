import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../common/services/prisma.service';
import { ConversationsService } from '../conversations/conversations.service';
import { FunnelService } from '../funnel/funnel.service';

const SYSTEM_PROMPT = `You are an AI assistant for INITE Billing Service. You help manage subscriptions, orders, referrals, and billing analytics.

You have tools to access real data. Always use tools before answering data questions.
Be concise. Respond in the user's language.

When helping with abandoned checkouts or funnel issues, suggest actionable next steps.`;

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);
  private client: Anthropic;

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversationsService: ConversationsService,
    private readonly funnelService: FunnelService,
  ) {
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  async *chat(
    userId: string,
    message: string,
    conversationId?: string,
    roles: string[] = [],
  ): AsyncGenerator<string> {
    // 1. Get or create conversation
    let conversation: any;
    if (conversationId) {
      conversation = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
      });
    }
    if (!conversation) {
      conversation = await this.conversationsService.getOrCreate(
        userId,
        'assistant',
      );
    }

    yield `event: conversation\ndata: ${JSON.stringify({ conversationId: conversation.id })}\n\n`;

    // 2. Save user message
    await this.conversationsService.addMessage(
      conversation.id,
      'user',
      message,
    );

    // 3. Load last 20 messages for context
    const history = await this.conversationsService.getMessages(
      conversation.id,
      20,
    );

    // 4. Build tools based on roles
    const tools = this.buildTools(roles);

    // 5. Build messages from history
    const messages = this.buildMessages(history, message);

    // 6. Multi-turn tool use loop (max 5 iterations)
    let currentMessages = messages;
    let fullText = '';

    for (let step = 0; step < 5; step++) {
      const stream = this.client.messages.stream({
        model: 'claude-sonnet-4-5-20250514',
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: currentMessages,
        tools,
      });

      const toolUses: Array<{ id: string; name: string; input: any }> = [];
      let currentToolUse: { id: string; name: string; input: string } | null =
        null;

      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          fullText += event.delta.text;
          yield `event: text_delta\ndata: ${JSON.stringify({ text: event.delta.text })}\n\n`;
        }

        if (
          event.type === 'content_block_start' &&
          event.content_block.type === 'tool_use'
        ) {
          currentToolUse = {
            id: event.content_block.id,
            name: event.content_block.name,
            input: '',
          };
        }

        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'input_json_delta'
        ) {
          if (currentToolUse) {
            currentToolUse.input += event.delta.partial_json;
          }
        }

        if (event.type === 'content_block_stop' && currentToolUse) {
          let parsedInput = {};
          try {
            if (currentToolUse.input) {
              parsedInput = JSON.parse(currentToolUse.input);
            }
          } catch {
            // empty input is fine
          }
          toolUses.push({
            id: currentToolUse.id,
            name: currentToolUse.name,
            input: parsedInput,
          });
          currentToolUse = null;
        }
      }

      const finalMessage = await stream.finalMessage();

      if (finalMessage.stop_reason !== 'tool_use' || toolUses.length === 0) {
        break;
      }

      // Execute tool calls
      const toolResults: any[] = [];
      for (const toolUse of toolUses) {
        yield `event: tool_call\ndata: ${JSON.stringify({ toolName: toolUse.name })}\n\n`;

        try {
          const result = await this.executeTool(
            toolUse.name,
            toolUse.input,
            userId,
            roles,
          );
          toolResults.push({
            type: 'tool_result' as const,
            tool_use_id: toolUse.id,
            content: JSON.stringify(result).slice(0, 4000),
          });
        } catch (error: any) {
          this.logger.error(
            `Tool ${toolUse.name} failed: ${error.message}`,
            error.stack,
          );
          toolResults.push({
            type: 'tool_result' as const,
            tool_use_id: toolUse.id,
            content: JSON.stringify({ error: error.message }),
            is_error: true,
          });
        }
      }

      // Add assistant response + tool results for next iteration
      currentMessages = [
        ...currentMessages,
        { role: 'assistant' as const, content: finalMessage.content },
        { role: 'user' as const, content: toolResults },
      ];
    }

    yield `event: done\ndata: {}\n\n`;

    // 8. Save assistant message
    if (fullText) {
      await this.conversationsService.addMessage(
        conversation.id,
        'assistant',
        fullText,
      );
    }
  }

  private buildMessages(
    history: Array<{ role: string; content: string }>,
    currentMessage: string,
  ): Anthropic.MessageParam[] {
    const messages: Anthropic.MessageParam[] = [];

    // Add history (skip the last user message we just added)
    for (const msg of history) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        // Avoid consecutive same-role messages
        if (
          messages.length > 0 &&
          messages[messages.length - 1].role === msg.role
        ) {
          continue;
        }
        messages.push({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        });
      }
    }

    // Ensure the last message is the current user message
    // If history already contains it (since we saved it above), check
    if (
      messages.length === 0 ||
      messages[messages.length - 1].role !== 'user' ||
      messages[messages.length - 1].content !== currentMessage
    ) {
      if (
        messages.length > 0 &&
        messages[messages.length - 1].role === 'user'
      ) {
        // Replace last user message with current one to avoid consecutive user messages
        messages[messages.length - 1] = {
          role: 'user',
          content: currentMessage,
        };
      } else {
        messages.push({ role: 'user', content: currentMessage });
      }
    }

    // Ensure messages start with a user message
    while (messages.length > 0 && messages[0].role !== 'user') {
      messages.shift();
    }

    // If somehow empty, add the current message
    if (messages.length === 0) {
      messages.push({ role: 'user', content: currentMessage });
    }

    return messages;
  }

  private buildTools(roles: string[]): Anthropic.Tool[] {
    const isAdmin = roles.includes('admin');

    const userTools: Anthropic.Tool[] = [
      {
        name: 'get_my_orders',
        description:
          'Get the current user orders with product details. Returns up to 20 recent orders.',
        input_schema: {
          type: 'object' as const,
          properties: {
            status: {
              type: 'string',
              description:
                'Optional filter by order status (created, paid, completed, refunded, cancelled)',
            },
          },
          required: [],
        },
      },
      {
        name: 'get_my_subscriptions',
        description:
          'Get the current user active subscriptions with product and price details.',
        input_schema: {
          type: 'object' as const,
          properties: {},
          required: [],
        },
      },
      {
        name: 'get_my_entitlements',
        description:
          'Get the current user active entitlements (what they have access to).',
        input_schema: {
          type: 'object' as const,
          properties: {},
          required: [],
        },
      },
      {
        name: 'get_catalog',
        description:
          'Get available products and prices in the catalog. Useful when user asks about what they can buy.',
        input_schema: {
          type: 'object' as const,
          properties: {
            serviceId: {
              type: 'string',
              description: 'Optional filter by service ID',
            },
          },
          required: [],
        },
      },
      {
        name: 'get_my_referral_stats',
        description:
          'Get the current user referral/affiliate statistics, including referral count and commissions.',
        input_schema: {
          type: 'object' as const,
          properties: {},
          required: [],
        },
      },
    ];

    const adminTools: Anthropic.Tool[] = [
      {
        name: 'get_admin_stats',
        description:
          'Get admin dashboard statistics: total orders, revenue, active subscriptions, affiliates.',
        input_schema: {
          type: 'object' as const,
          properties: {},
          required: [],
        },
      },
      {
        name: 'search_orders',
        description:
          'Search and filter orders as admin. Supports filtering by status, userId, with pagination.',
        input_schema: {
          type: 'object' as const,
          properties: {
            status: {
              type: 'string',
              description: 'Filter by order status',
            },
            userId: {
              type: 'string',
              description: 'Filter by user ID',
            },
            page: {
              type: 'number',
              description: 'Page number (default 1)',
            },
            limit: {
              type: 'number',
              description: 'Items per page (default 20)',
            },
          },
          required: [],
        },
      },
      {
        name: 'get_funnel_metrics',
        description:
          'Get conversion funnel metrics: stage counts, conversion rates, abandoned checkouts.',
        input_schema: {
          type: 'object' as const,
          properties: {
            serviceId: {
              type: 'string',
              description: 'Optional filter by service ID',
            },
            days: {
              type: 'number',
              description: 'Number of days to look back (default: all time)',
            },
          },
          required: [],
        },
      },
      {
        name: 'get_abandoned_checkouts',
        description:
          'Get list of abandoned checkout orders with details for follow-up.',
        input_schema: {
          type: 'object' as const,
          properties: {
            page: {
              type: 'number',
              description: 'Page number (default 1)',
            },
            limit: {
              type: 'number',
              description: 'Items per page (default 20)',
            },
          },
          required: [],
        },
      },
      {
        name: 'get_services',
        description: 'Get all registered services.',
        input_schema: {
          type: 'object' as const,
          properties: {},
          required: [],
        },
      },
      {
        name: 'get_promo_codes',
        description: 'Get all promo codes with their usage details.',
        input_schema: {
          type: 'object' as const,
          properties: {},
          required: [],
        },
      },
    ];

    return isAdmin ? [...userTools, ...adminTools] : userTools;
  }

  private async executeTool(
    name: string,
    args: any,
    userId: string,
    roles: string[],
  ): Promise<any> {
    const isAdmin = roles.includes('admin');

    switch (name) {
      case 'get_my_orders': {
        const where: any = { userId };
        if (args.status) where.status = args.status;
        return this.prisma.order.findMany({
          where,
          include: { price: { include: { product: true } } },
          take: 20,
          orderBy: { createdAt: 'desc' },
        });
      }

      case 'get_my_subscriptions':
        return this.prisma.subscription.findMany({
          where: { userId },
          include: { price: { include: { product: true } } },
        });

      case 'get_my_entitlements':
        return this.prisma.entitlement.findMany({
          where: { userId, status: 'active' },
        });

      case 'get_catalog': {
        const where: any = { isActive: true };
        if (args.serviceId) where.serviceId = args.serviceId;
        return this.prisma.product.findMany({
          where,
          include: {
            prices: { where: { isActive: true } },
            service: true,
          },
        });
      }

      case 'get_my_referral_stats': {
        const affiliate = await this.prisma.affiliate.findFirst({
          where: { userId },
        });
        if (!affiliate) {
          return { affiliate: null, referralCount: 0, totalCommissions: 0 };
        }
        const referralCount = await this.prisma.referral.count({
          where: { affiliateId: affiliate.id },
        });
        const commissions = await this.prisma.affiliateCommission.aggregate({
          where: { affiliateId: affiliate.id },
          _sum: { amount: true },
        });
        return {
          affiliate,
          referralCount,
          totalCommissions: commissions._sum.amount || 0,
        };
      }

      // Admin tools
      case 'get_admin_stats': {
        if (!isAdmin) throw new Error('Admin access required');
        const [
          totalOrders,
          revenue,
          activeSubscriptions,
          totalAffiliates,
        ] = await Promise.all([
          this.prisma.order.count(),
          this.prisma.order.aggregate({
            where: { status: 'paid' },
            _sum: { amount: true },
          }),
          this.prisma.subscription.count({
            where: { status: 'active' },
          }),
          this.prisma.affiliate.count(),
        ]);
        return {
          totalOrders,
          revenue: revenue._sum.amount || 0,
          activeSubscriptions,
          totalAffiliates,
        };
      }

      case 'search_orders': {
        if (!isAdmin) throw new Error('Admin access required');
        const searchWhere: any = {};
        if (args.status) searchWhere.status = args.status;
        if (args.userId) searchWhere.userId = args.userId;
        const page = args.page || 1;
        const limit = args.limit || 20;
        const [items, total] = await Promise.all([
          this.prisma.order.findMany({
            where: searchWhere,
            include: { price: { include: { product: true } } },
            take: limit,
            skip: (page - 1) * limit,
            orderBy: { createdAt: 'desc' },
          }),
          this.prisma.order.count({ where: searchWhere }),
        ]);
        return { items, total, page, limit };
      }

      case 'get_funnel_metrics': {
        if (!isAdmin) throw new Error('Admin access required');
        const params: any = {};
        if (args.serviceId) params.serviceId = args.serviceId;
        if (args.days) {
          params.from = new Date(Date.now() - args.days * 86400000);
        }
        return this.funnelService.getFunnelMetrics(params);
      }

      case 'get_abandoned_checkouts': {
        if (!isAdmin) throw new Error('Admin access required');
        return this.funnelService.getAbandonedCheckouts({
          page: args.page,
          limit: args.limit,
        });
      }

      case 'get_services': {
        if (!isAdmin) throw new Error('Admin access required');
        return this.prisma.service.findMany();
      }

      case 'get_promo_codes': {
        if (!isAdmin) throw new Error('Admin access required');
        return this.prisma.promoCode.findMany({
          include: { _count: { select: { usages: true } } },
        });
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}
