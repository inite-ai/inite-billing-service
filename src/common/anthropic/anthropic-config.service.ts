import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface AnthropicMessageParams {
  model: string;
  max_tokens: number;
  temperature?: number;
}

@Injectable()
export class AnthropicConfigService {
  constructor(private readonly config: ConfigService) {}

  get model(): string {
    return this.config.get<string>('ANTHROPIC_MODEL') || 'claude-sonnet-4-5';
  }

  get maxTokens(): number {
    const parsed = Number(this.config.get('ANTHROPIC_MAX_TOKENS'));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 2048;
  }

  get temperature(): number | undefined {
    const raw = this.config.get<string>('ANTHROPIC_TEMPERATURE');
    if (raw === undefined || raw === '') return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  get actionTtlMinutes(): number {
    const parsed = Number(this.config.get('ASSISTANT_ACTION_TTL_MINUTES'));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 15;
  }

  messageParams(overrides: { maxTokens?: number } = {}): AnthropicMessageParams {
    const temperature = this.temperature;
    return {
      model: this.model,
      max_tokens: overrides.maxTokens ?? this.maxTokens,
      ...(temperature !== undefined && { temperature }),
    };
  }
}
