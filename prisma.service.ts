import { Injectable, OnModuleInit } from '@nestjs/common';
import { db } from '@keyflow/db';

@Injectable()
export class PrismaService extends db implements OnModuleInit {
  async onModuleInit() {
    // Optional: Add a hook to connect to the database when the module is initialized.
    // By default, Prisma connects lazily on the first query.
    // await this.$connect();
  }
}