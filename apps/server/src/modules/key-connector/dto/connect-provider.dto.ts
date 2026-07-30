import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

/**
 * ── Connect Provider DTO ───────────────────────────────────────────────
 * Payload for creating a new provider connection.
 * ───────────────────────────────────────────────────────────────────────
 */

export class ConnectProviderDto {
  @IsString()
  @IsNotEmpty()
  providerKey: string;

  @IsObject()
  @IsOptional()
  authData?: Record<string, unknown>;

  @IsObject()
  @IsOptional()
  settings?: Record<string, unknown>;

  @IsString()
  @IsOptional()
  displayName?: string;
}
