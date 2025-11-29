import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { db } from '@keyflow/db';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  // Loosen typing to simplify testing/mocking while keeping runtime wired to generated client.
  readonly client: any = db;

  async onModuleInit() {
    // Connect lazily on first query by default; uncomment to force eager connect
    // await this.client.$connect();
  }

  async onModuleDestroy() {
    await this.client.$disconnect();
  }
}
