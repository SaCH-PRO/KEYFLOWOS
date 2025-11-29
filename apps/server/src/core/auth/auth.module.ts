import { Global, Module } from '@nestjs/common';
import { SupabaseAuthService } from './supabase-auth.service';
import { AuthGuard } from './auth.guard';
import { BusinessGuard } from './business.guard';

@Global()
@Module({
  providers: [SupabaseAuthService, AuthGuard, BusinessGuard],
  exports: [SupabaseAuthService, AuthGuard, BusinessGuard],
})
export class AuthModule {}
