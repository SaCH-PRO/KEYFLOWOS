import { ConflictException } from '@nestjs/common';

/**
 * W11-DISPATCH-REFUSAL-FINAL (owner ruling D-134): a 409 that asks the caller to try again, because
 * the answer may differ the next time (a write that lost an optimistic-concurrency race). Over HTTP
 * it is ConflictException(message) exactly: the same status and body, and `instanceof
 * ConflictException` holds.
 *
 * KEY's plan queue takes a tool's 409 as final (answered once, counted toward no circuit) unless the
 * service throws this class, which FlowOrchestratorService.executeToolDirectly hands the dispatcher
 * as a failure: retried, and counted toward that business's circuit for the tool if it never
 * clears. Services that throw it: ProjectsService.updateTask's stale write, and (since
 * FU-KEY-INVOICE-EMAIL-PAY-LINK, D-248) CommerceService.reissueLink when a pending pay link was
 * withdrawn under the caller while being handed out. A conflict a retry answers the same way (a
 * duplicate, a state that has already moved on, every money conflict) stays a plain
 * ConflictException.
 */
export class RetryableConflictException extends ConflictException {
  constructor(message: string) {
    super(message);
  }
}
