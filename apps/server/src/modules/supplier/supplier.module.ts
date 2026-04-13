import { Module } from '@nestjs/common';
import { SupplierController } from './supplier.controller';
import { SupplierService } from './supplier.service';
import { ProductNormalizationService } from './product-normalization.service';
import { PrismaModule } from '../../core/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [SupplierController],
  providers: [SupplierService, ProductNormalizationService],
  exports: [SupplierService, ProductNormalizationService],
})
export class SupplierModule {}
