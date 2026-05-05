import { Global, Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

/**
 * Shared Catalog domain (S1).
 *
 * Single owner of Product + Service CRUD across Store, Commerce, and
 * Bookings. Exported globally so any module can inject CatalogService
 * without an explicit `imports: [CatalogModule]` everywhere.
 */
@Global()
@Module({
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
