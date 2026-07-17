import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class EmbeddingsService {
  private readonly logger = new Logger(EmbeddingsService.name);

  constructor(private readonly config: ConfigService) {}

  get enabled(): boolean {
    return this.config.get('EMBEDDINGS_ENABLED') === 'true' && !!this.config.get('OPENAI_API_KEY');
  }

  get model(): string {
    return this.config.get<string>('EMBEDDINGS_MODEL') || 'text-embedding-3-small';
  }

  /**
   * Embed a batch of texts (max 100 per call).
   * Returns null when embeddings are disabled — callers fall back to ILIKE.
   */
  async embed(texts: string[]): Promise<number[][] | null> {
    if (!this.enabled) return null;
    if (texts.length === 0) return [];
    if (texts.length > 100) {
      throw new Error('Embedding batch size limit is 100');
    }

    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.get('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: this.model, input: texts }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      throw new Error(`Embeddings API ${res.status}: ${bodyText.slice(0, 300)}`);
    }

    const data = (await res.json()) as {
      data: Array<{ index: number; embedding: number[] }>;
    };
    return data.data.sort((a, b) => a.index - b.index).map((item) => item.embedding);
  }
}
