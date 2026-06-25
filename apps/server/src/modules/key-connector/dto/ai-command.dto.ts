import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

/**
 * ── AI Command DTO ─────────────────────────────────────────────────────
 * Payload for routing an AI/natural-language command through the
 * KeyConnector gateway.
 * ───────────────────────────────────────────────────────────────────────
 */

export class AiCommandDto {
  @IsString()
  @IsNotEmpty()
  command: string;

  @IsObject()
  @IsOptional()
  context?: Record<string, unknown>;
}
