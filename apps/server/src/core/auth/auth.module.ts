import { Global, Module } from '@nestjs/common';
import { SupabaseAuthService } from './supabase-auth.service';

@Global()
@Module({
  providers: [SupabaseAuthService],
  exports: [SupabaseAuthService],
})
export class AuthModule {}
