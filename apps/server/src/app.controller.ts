import { Controller, Get, Inject } from '@nestjs/common';
import { AppService } from './app.service';
import { PrismaService } from './core/prisma/prisma.service';
import { BusinessEventQueueService } from './modules/business-events/business-event.queue';
import { getReleaseVersion } from '@keyflow/shared/release-version';

const BOOT_TIME_MS = Date.now();

async function getCommit(): Promise<string> {
  return (await getReleaseVersion()).short;
}

@Controller()
export class AppController {
  constructor(
    @Inject(AppService) private readonly appService: AppService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessEventQueueService) private readonly eventQueue: BusinessEventQueueService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /**
   * Cheap liveness check. Returns 200 as long as the process is alive.
   * Bypasses auth + rate-limit middleware (see app.module.ts).
   */
  @Get('healthz')
  async healthz() {
    return {
      status: 'ok',
      uptimeSec: Math.round((Date.now() - BOOT_TIME_MS) / 1000),
      commit: await getCommit(),
      nodeVersion: process.version,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Readiness check. Pings the DB via the PrismaService health probe.
   * Returns 503 if the DB is unreachable so load balancers / waitForPort
   * can hold traffic until the app is truly ready to serve.
   */
  @Get('readyz')
  async readyz() {
    const { ok, latencyMs } = await this.prisma.isHealthy();
    const body = {
      status: ok ? 'ready' : 'not-ready',
      uptimeSec: Math.round((Date.now() - BOOT_TIME_MS) / 1000),
      commit: await getCommit(),
      db: { ok, latencyMs },
      timestamp: new Date().toISOString(),
    };

    if (!ok) {
      const { HttpException, HttpStatus } = await import('@nestjs/common');
      throw new HttpException(body, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return body;
  }

  @Get('healthz/events')
  async eventHealth() {
    const queueHealth = await this.eventQueue.getHealth();
    return {
      status: 'ok',
      events: queueHealth,
      timestamp: new Date().toISOString(),
    };
  }
}
