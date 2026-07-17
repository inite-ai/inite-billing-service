import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { OutreachService } from '../outreach/outreach.service';

// Low concurrency bounds LLM cost/latency; ~worst case is fine for a 15-min cadence
@Processor('outreach', {
  concurrency: 2,
})
export class OutreachProcessor extends WorkerHost {
  private readonly logger = new Logger(OutreachProcessor.name);

  constructor(private readonly outreachService: OutreachService) {
    super();
  }

  async process(job: Job<{ outreachId: string }>): Promise<void> {
    await this.outreachService.processOne(job.data.outreachId);
  }
}
