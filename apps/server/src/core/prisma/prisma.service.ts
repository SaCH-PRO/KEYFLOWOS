import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { db } from '@keyflow/db';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly client = db;

  async onModuleInit() {
    // Connect lazily on first query by default; uncomment to force eager connect
    // await this.client.$connect();
  }

  async onModuleDestroy() {
    await this.client.$disconnect();
  }
}
