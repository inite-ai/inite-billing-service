import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { HealthService, ReadinessReport } from './health.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /** Liveness: the process is up and serving. Deliberately dependency-free. */
  @Get()
  @ApiOperation({ summary: 'Liveness check' })
  check() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  /**
   * Readiness: the dependencies are reachable. 503 when any of them is down, so
   * a deploy gate or container healthcheck fails on a service that is up but
   * unable to do any work.
   */
  @Get('ready')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Readiness check (database + redis)' })
  @ApiResponse({ status: 200, description: 'All dependencies reachable' })
  @ApiResponse({ status: 503, description: 'A dependency is unreachable' })
  async ready(@Res({ passthrough: true }) res: Response): Promise<ReadinessReport> {
    const report = await this.healthService.check();
    if (report.status !== 'ok') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return report;
  }
}
