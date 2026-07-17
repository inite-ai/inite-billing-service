import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { ANTHROPIC_CLIENT } from './anthropic.constants';
import { AnthropicConfigService } from './anthropic-config.service';

@Global()
@Module({
  providers: [
    AnthropicConfigService,
    {
      provide: ANTHROPIC_CLIENT,
      useFactory: (config: ConfigService) =>
        new Anthropic({ apiKey: config.get<string>('ANTHROPIC_API_KEY') }),
      inject: [ConfigService],
    },
  ],
  exports: [ANTHROPIC_CLIENT, AnthropicConfigService],
})
export class AnthropicModule {}
