import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../common/services/prisma.service';
import { ANTHROPIC_CLIENT } from '../common/anthropic/anthropic.constants';
import { AnthropicConfigService } from '../common/anthropic/anthropic-config.service';
import { FunnelService } from '../funnel/funnel.service';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export interface FunnelInsightRequest {
  serviceId?: string;
  from?: Date;
  to?: Date;
  granularity?: 'day' | 'week' | 'month';
  locale?: string;
  force?: boolean;
}

/** Pure prompt builder — unit-testable without API calls. */
export function buildFunnelInsightPrompt(
  current: any,
  previous: any,
  series: any[],
  locale: string,
): { system: string; user: string } {
  const system = `You are a billing/conversion analyst for the INITE platform.
Given funnel metrics for the current period, the previous period of equal length, and a time series, produce:
1. A one-line headline of the most important change.
2. 3-5 numbered findings, each citing the actual numbers (counts, rates, deltas).
3. 2-3 recommended actions.
Write in ${locale === 'ru' ? 'Russian' : 'English'}. Plain text with simple markdown (bold, numbered lists). Be specific — never invent numbers not present in the data.`;

  const user = JSON.stringify({ current, previous, series });
  return { system, user };
}

@Injectable()
export class InsightsService {
  private readonly logger = new Logger(InsightsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly funnelService: FunnelService,
    private readonly anthropicConfig: AnthropicConfigService,
    @Inject(ANTHROPIC_CLIENT) private readonly anthropic: Anthropic,
  ) {}

  async explainFunnel(request: FunnelInsightRequest): Promise<{
    content: string;
    generatedAt: Date;
    cached: boolean;
    model: string;
  }> {
    const to = request.to ?? new Date();
    const from = request.from ?? new Date(to.getTime() - 30 * 86_400_000);
    const granularity = request.granularity ?? 'day';
    const locale = request.locale === 'ru' ? 'ru' : 'en';

    const scopeKey = createHash('sha1')
      .update(
        [
          request.serviceId ?? '-',
          from.toISOString().slice(0, 10),
          to.toISOString().slice(0, 10),
          granularity,
        ].join('|'),
      )
      .digest('hex');

    if (!request.force) {
      const cached = await this.prisma.aiInsight.findUnique({
        where: { kind_scopeKey_locale: { kind: 'funnel', scopeKey, locale } },
      });
      if (cached && Date.now() - cached.createdAt.getTime() < CACHE_TTL_MS) {
        return {
          content: cached.content,
          generatedAt: cached.createdAt,
          cached: true,
          model: cached.model,
        };
      }
    }

    const periodMs = to.getTime() - from.getTime();
    const [current, previous, series] = await Promise.all([
      this.funnelService.getFunnelMetrics({
        serviceId: request.serviceId,
        from,
        to,
      }),
      this.funnelService.getFunnelMetrics({
        serviceId: request.serviceId,
        from: new Date(from.getTime() - periodMs),
        to: from,
      }),
      this.funnelService.getFunnelTimeSeries({
        serviceId: request.serviceId,
        from,
        to,
        granularity,
      }),
    ]);

    const prompt = buildFunnelInsightPrompt(current, previous, series, locale);
    const model = this.anthropicConfig.model;

    const response = await this.anthropic.messages.create(
      {
        model,
        max_tokens: 1200,
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
      },
      { signal: AbortSignal.timeout(30_000), maxRetries: 1 },
    );

    const content =
      response.content[0]?.type === 'text' ? response.content[0].text : '';
    if (!content.trim()) {
      throw new Error('Insight generation returned empty content');
    }

    const saved = await this.prisma.aiInsight.upsert({
      where: { kind_scopeKey_locale: { kind: 'funnel', scopeKey, locale } },
      create: {
        kind: 'funnel',
        scopeKey,
        locale,
        content,
        data: { current, previous } as any,
        model,
      },
      update: {
        content,
        data: { current, previous } as any,
        model,
        createdAt: new Date(),
      },
    });

    this.logger.log(
      JSON.stringify({
        event: 'funnel_insight_generated',
        scopeKey,
        locale,
        inputTokens: response.usage?.input_tokens,
        outputTokens: response.usage?.output_tokens,
      }),
    );

    return {
      content: saved.content,
      generatedAt: saved.createdAt,
      cached: false,
      model,
    };
  }
}
