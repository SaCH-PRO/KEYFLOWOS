import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { AuthModule } from '../../core/auth/auth.module';
import { DeviceController } from './device.controller';
import { DeviceService } from './device.service';
import { VisualClassifierService } from './visual-classifier.service';
import { CommandModule } from '../command/command.module';

@Module({
  imports: [PrismaModule, AuthModule, CommandModule],
  controllers: [DeviceController],
  providers: [DeviceService, VisualClassifierService],
  exports: [DeviceService, VisualClassifierService],
})
export class DeviceModule {}
