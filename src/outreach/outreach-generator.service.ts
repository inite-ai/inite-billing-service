import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { ANTHROPIC_CLIENT } from '../common/anthropic/anthropic.constants';
import { AnthropicConfigService } from '../common/anthropic/anthropic-config.service';

export interface OutreachContext {
  trigger: string;
  locale: 'en' | 'ru';
  productName?: string;
  serviceName?: string;
  amount?: string;
  currency?: string;
  interval?: string;
  daysOverdue?: number;
  periodEnd?: string;
  ctaLabel?: string;
}

export interface GeneratedOutreach {
  subject: string;
  body: string;
  source: 'llm';
  model: string;
  inputTokens?: number;
  outputTokens?: number;
}

const TRIGGER_PERSONA: Record<string, string> = {
  abandoned_checkout:
    'You write short, friendly reminders about unfinished checkouts.',
  dunning:
    'You write short, calm, helpful payment-issue notices. Never threaten; focus on how easy it is to fix.',
  winback:
    'You write short, warm retention notes for users whose subscription is ending. Acknowledge their choice, no guilt-tripping.',
  trial_ending:
    'You write short, helpful reminders that a free trial is about to end.',
};

@Injectable()
export class OutreachGeneratorService {
  private readonly logger = new Logger(OutreachGeneratorService.name);

  constructor(
    @Inject(ANTHROPIC_CLIENT) private readonly client: Anthropic,
    private readonly anthropicConfig: AnthropicConfigService,
    private readonly config: ConfigService,
  ) {}

  get model(): string {
    return (
      this.config.get<string>('OUTREACH_MODEL') || this.anthropicConfig.model
    );
  }

  /**
   * Generate a personalized subject+body via Claude.
   * Throws on any failure — the caller falls back to static templates.
   * No PII (email, name) is ever sent to the model.
   */
  async generate(context: OutreachContext): Promise<GeneratedOutreach> {
    const persona =
      TRIGGER_PERSONA[context.trigger] ??
      'You write short, friendly billing-related notes.';

    const system = `${persona}
You write on behalf of INITE Billing.
Rules:
- Write in ${context.locale === 'ru' ? 'Russian' : 'English'}.
- Subject under 70 characters, no emoji spam (one emoji max).
- Body: plain text, under 150 words, warm and specific to the provided context.
- Reference the call-to-action exactly once as the literal placeholder {{cta_url}} on its own line or inline.
- Never invent discounts, prices, dates or claims not present in the context.
- Output STRICT JSON: {"subject": "...", "body": "..."} and nothing else.`;

    const response = await this.client.messages.create(
      {
        model: this.model,
        max_tokens: 600,
        system,
        messages: [
          {
            role: 'user',
            content: JSON.stringify({
              trigger: context.trigger,
              product: context.productName,
              service: context.serviceName,
              amount: context.amount,
              currency: context.currency,
              interval: context.interval,
              daysOverdue: context.daysOverdue,
              periodEnd: context.periodEnd,
              ctaLabel: context.ctaLabel,
            }),
          },
        ],
      },
      { signal: AbortSignal.timeout(20_000), maxRetries: 1 },
    );

    const text =
      response.content[0]?.type === 'text' ? response.content[0].text : '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error('LLM output contained no JSON object');
    }
    const parsed = JSON.parse(match[0]) as { subject?: string; body?: string };
    if (!parsed.subject?.trim() || !parsed.body?.trim()) {
      throw new Error('LLM output missing subject or body');
    }

    // Never trust raw links from the model — the server substitutes {{cta_url}}
    const sanitizedBody = parsed.body
      .replace(/https?:\/\/\S+/gi, '')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();

    return {
      subject: parsed.subject.trim().slice(0, 200),
      body: sanitizedBody,
      source: 'llm',
      model: this.model,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
    };
  }
}
