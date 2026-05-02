import { Controller, Get, Inject } from '@nestjs/common';
import { AppService } from './app.service';
import { PrismaService } from './core/prisma/prisma.service';
import { getReleaseVersion } from './core/utils/release-version';

const BOOT_TIME_MS = Date.now();

function getCommit(): string {
  return getReleaseVersion().short;
}

@Controller()
export class AppController {
  constructor(
    @Inject(AppService) private readonly appService: AppService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
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
  healthz() {
    return {
      status: 'ok',
      uptimeSec: Math.round((Date.now() - BOOT_TIME_MS) / 1000),
      commit: getCommit(),
      nodeVersion: process.version,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Readiness check. Pings the DB. Returns 503 if the DB is unreachable so
   * load balancers / waitForPort can hold traffic until the app is truly
   * ready to serve.
   */
  @Get('readyz')
  async readyz() {
    const startedAt = Date.now();
    try {
      await this.prisma.client.$queryRawUnsafe('SELECT 1');
      return {
        status: 'ready',
        uptimeSec: Math.round((Date.now() - BOOT_TIME_MS) / 1000),
        commit: getCommit(),
        db: { ok: true, latencyMs: Date.now() - startedAt },
        timestamp: new Date().toISOString(),
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      // Throw an HTTP 503-equivalent shaped response. We avoid HttpException
      // here so the global filter doesn't transform the body; instead set
      // status manually via a Nest hack: throw an error that the filter
      // surfaces. Simpler: return body but with status set via @Res. To keep
      // this controller dependency-free, we use the standard Nest pattern of
      // throwing an HttpException.
      const { HttpException, HttpStatus } = await import('@nestjs/common');
      throw new HttpException(
        {
          status: 'not-ready',
          uptimeSec: Math.round((Date.now() - BOOT_TIME_MS) / 1000),
          commit: getCommit(),
          db: { ok: false, error: message },
          timestamp: new Date().toISOString(),
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
