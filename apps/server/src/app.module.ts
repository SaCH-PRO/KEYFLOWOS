import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './core/prisma/prisma.module';
import { EventBusModule } from './core/event-bus/event-bus.module';
import { TrpcModule } from './modules/trpc/trpc.module';

@Module({
  imports: [
    // Core Modules
    PrismaModule,
    EventBusModule,
    TrpcModule, // <-- IMPORT THE TRPC MODULE

    // Feature Modules
    // IdentityModule,
    // CrmModule,
    // ... all other modules
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}