import { Module } from '@nestjs/common';
import { SeedService } from './seed.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [SeedService],
})
export class SeedModule {}
