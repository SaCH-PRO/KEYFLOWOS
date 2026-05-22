import { Module } from '@nestjs/common';
import { SeedService } from './seed.service';
import { PrismaModule } from '../prisma/prisma.module';
import { IdentityModule } from '../../modules/identity/identity.module';

@Module({
  imports: [PrismaModule, IdentityModule],
  providers: [SeedService],
})
export class SeedModule {}
