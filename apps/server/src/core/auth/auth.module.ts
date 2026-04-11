import { Global, Module } from '@nestjs/common';
import { SupabaseAuthService } from './supabase-auth.service';
import { AuthGuard } from './auth.guard';
import { BusinessGuard } from './business.guard';
import { OptionalAuthGuard } from './optional-auth.guard';

@Global()
@Module({
  providers: [SupabaseAuthService, AuthGuard, BusinessGuard, OptionalAuthGuard],
  exports: [SupabaseAuthService, AuthGuard, BusinessGuard, OptionalAuthGuard],
})
export class AuthModule {}
