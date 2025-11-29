import { Global, Module } from '@nestjs/common';
import { SupabaseAuthService } from './supabase-auth.service';
import { AuthGuard } from './auth.guard';

@Global()
@Module({
  providers: [SupabaseAuthService, AuthGuard],
  exports: [SupabaseAuthService, AuthGuard],
})
export class AuthModule {}
