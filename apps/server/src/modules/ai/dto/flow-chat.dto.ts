import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import type { FlowAttachment, FlowMessage, FlowPageContext } from '../flow-orchestrator.service';

/**
 * The bodies of POST /ai/businesses/:businessId/flow/chat and /flow/chat/stream, as classes
 * (V1-21b review 7 ENV-FORGE / INP5-2 / DRV5-3).
 *
 * Both routes used to declare an inline-typed @Body(). tsc emits such a parameter's
 * design:paramtypes entry as `Object`, and the global ValidationPipe (whitelist: true) skips
 * `Object`, so the body reached the handler exactly as sent: pageContext.jobRoleEnvelope went
 * on to every AiOversightService.evaluate call, where an envelope replaces the crew check, and
 * the stream route took a crew role from the client.
 *
 * Deliberately NOT here:
 *  - pageContext.jobRoleEnvelope. A position envelope is governance, not page context; only the
 *    server issues one (JobRolePolicyService, through StaffChatBridgeService) and
 *    FlowOrchestratorService takes it only as a separate server-only argument;
 *  - role. A member does not choose the crew KEY governs their turn with.
 * The ValidationPipe strips both, and every other key a client sends that is not declared.
 *
 * Field validation is as loose as the handler's own reads: the free-form parts (history,
 * attachments, focusedItem, recent, notes, hints, toolArgs) are checked for shape only, so
 * every body the web client sends today still passes.
 */
export class FlowPageContextDto implements Omit<FlowPageContext, 'focusedItem' | 'recent' | 'notes'> {
  @IsOptional()
  @IsString()
  surface?: string;

  @IsOptional()
  @IsString()
  route?: string;

  @IsOptional()
  @IsObject()
  focusedItem?: FlowPageContext['focusedItem'];

  @IsOptional()
  @IsArray()
  recent?: FlowPageContext['recent'];

  @IsOptional()
  @IsArray()
  notes?: FlowPageContext['notes'];

  @IsOptional()
  @IsArray()
  hints?: string[];
}

/** A quick confirmation the client sends back for a pending tool call. */
export class FlowPendingConfirmationDto {
  @IsString()
  toolCallId!: string;

  @IsBoolean()
  confirmed!: boolean;

  @IsOptional()
  @IsString()
  toolName?: string;

  @IsOptional()
  @IsObject()
  toolArgs?: Record<string, unknown>;

  /** Server-issued id of the action being confirmed (KF-EXEC-ACTION-001). */
  @IsOptional()
  @IsString()
  confirmationId?: string;
}

/** What both chat routes take. */
export class FlowChatStreamDto {
  @IsString()
  message!: string;

  @IsOptional()
  @IsArray()
  history?: FlowMessage[];

  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => FlowPageContextDto)
  pageContext?: FlowPageContextDto;

  @IsOptional()
  @IsArray()
  attachments?: FlowAttachment[];
}

/** POST flow/chat: the stream body, plus a pending confirmation. */
export class FlowChatDto extends FlowChatStreamDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => FlowPendingConfirmationDto)
  pendingConfirmation?: FlowPendingConfirmationDto;
}
