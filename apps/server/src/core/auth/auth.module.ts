import { Global, Module } from '@nestjs/common';
import { SupabaseAuthService } from './supabase-auth.service';
import { AuthGuard } from './auth.guard';
import { BusinessGuard } from './business.guard';
import { OptionalAuthGuard } from './optional-auth.guard';
import { ModuleScopeGuard } from './module-scope.guard';

@Global()
@Module({
  providers: [SupabaseAuthService, AuthGuard, BusinessGuard, OptionalAuthGuard, ModuleScopeGuard],
  exports: [SupabaseAuthService, AuthGuard, BusinessGuard, OptionalAuthGuard, ModuleScopeGuard],
})
export class AuthModule {}
