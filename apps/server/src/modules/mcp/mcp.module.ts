import { Module } from '@nestjs/common';
import { McpClientManagerService } from './mcp-client-manager.service';

@Module({
  providers: [McpClientManagerService],
  exports: [McpClientManagerService],
})
export class McpModule {}
