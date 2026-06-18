import { Module } from '@nestjs/common';
import { BusinessAssetsService } from './business-assets.service';
import { BusinessAssetsController } from './business-assets.controller';

@Module({
  providers: [BusinessAssetsService],
  controllers: [BusinessAssetsController],
  exports: [BusinessAssetsService],
})
export class BusinessAssetsModule {}
