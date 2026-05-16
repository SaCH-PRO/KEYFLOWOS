import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { db, dbHealth } from '@keyflow/db';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  // Keep runtime wiring to the generated Prisma client while preserving its typing.
  readonly client: typeof db = db;

  async onModuleInit() {
    // Attempt to connect with exponential backoff. If the DB is briefly
    // unavailable at boot (e.g. container start-order race), retry instead
    // of crashing the entire application.
    const maxRetries = 5;
    const baseDelayMs = 500;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const { ok, latencyMs } = await dbHealth();
      if (ok) {
        this.logger.log(`Prisma connected (health-check ${latencyMs}ms)`);
        return;
      }

      if (attempt === maxRetries) {
        this.logger.error(
          `Prisma failed to connect after ${maxRetries} attempts. ` +
            `The application will continue starting but queries will fail until the database is reachable.`,
        );
        return;
      }

      const delay = baseDelayMs * 2 ** (attempt - 1);
      this.logger.warn(`DB unreachable (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  async onModuleDestroy() {
    this.logger.log('Disconnecting Prisma...');
    await this.client.$disconnect().catch((err: unknown) => {
      this.logger.warn(`Prisma disconnect error: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  /**
   * Lightweight readiness probe. Called by /readyz to ensure the DB is
   * still reachable before the orchestrator routes traffic here.
   */
  async isHealthy(): Promise<{ ok: boolean; latencyMs: number }> {
    return dbHealth();
  }
}
