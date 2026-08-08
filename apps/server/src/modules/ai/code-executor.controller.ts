import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { CodeExecutorService } from './code-executor.service';

/**
 * Tool bridge for the E2B code-execution backend. Public by necessity (E2B
 * microVMs cannot send user JWTs); every call is authenticated by a one-time
 * execution token minted by CodeExecutorService for the lifetime of a single
 * execution — no token, no tools.
 */
@Controller('code-executor')
export class CodeExecutorController {
  constructor(private readonly executor: CodeExecutorService) {}

  @Post('tool-bridge')
  @HttpCode(200)
  toolBridge(
    @Headers('x-exec-token') token: string | undefined,
    @Body() body: { name?: string; args?: Record<string, unknown> },
  ) {
    return this.executor.handleToolBridge(token, body ?? {});
  }
}
