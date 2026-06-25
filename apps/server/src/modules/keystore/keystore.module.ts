// ─────────────────────────────────────────────────────────────────────────────
// KeyStore Service Marketplace — NestJS Module
// ─────────────────────────────────────────────────────────────────────────────

import { Module } from '@nestjs/common';
import { KeystoreService } from './keystore.service';
import { KeystoreController } from './keystore.controller';
import { KeystoreAdminController } from './keystore-admin.controller';

@Module({
  controllers: [KeystoreController, KeystoreAdminController],
  providers: [KeystoreService],
  exports: [KeystoreService],
})
export class KeystoreModule {}
