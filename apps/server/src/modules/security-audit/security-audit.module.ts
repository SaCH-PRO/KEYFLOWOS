import { Module } from '@nestjs/common';
import { SecurityAuditService } from './security-audit.service';
import { SecurityAuditController } from './security-audit.controller';

@Module({
  providers: [SecurityAuditService],
  controllers: [SecurityAuditController],
  exports: [SecurityAuditService],
})
export class SecurityAuditModule {}
