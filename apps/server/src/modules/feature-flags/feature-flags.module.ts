import { Module } from '@nestjs/common';
import { FeatureFlagsService } from './feature-flags.service';
import { AdminFeatureFlagsController, FeatureFlagsController } from './feature-flags.controller';

@Module({
  controllers: [FeatureFlagsController, AdminFeatureFlagsController],
  providers: [FeatureFlagsService],
  exports: [FeatureFlagsService],
})
export class FeatureFlagsModule {}
