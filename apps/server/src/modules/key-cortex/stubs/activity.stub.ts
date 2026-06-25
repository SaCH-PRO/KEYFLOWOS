/**
 * Stub ActivityService for KEY Cortex integration safety pass.
 *
 * The original commit referenced a non-existent `activity` domain module.
 * This stub preserves compilation while clearly marking activity/audit
 * capabilities as not yet wired. It should be replaced with the real
 * activity/logging integration once the domain surface is finalized.
 */
import { Injectable } from '@nestjs/common';

@Injectable()
export class ActivityService {
  private notImplemented(action: string): never {
    throw new Error(
      `Activity action "${action}" is not wired in this build. ` +
        'Wire activity/audit module integration before enabling.',
    );
  }

  async log(..._args: unknown[]) {
    this.notImplemented('log');
  }
  async logBulk(..._args: unknown[]) {
    this.notImplemented('logBulk');
  }
  async createAuditNote(..._args: unknown[]) {
    this.notImplemented('createAuditNote');
  }
  async exportAuditLog(..._args: unknown[]) {
    this.notImplemented('exportAuditLog');
  }
  async deleteOldLogs(..._args: unknown[]) {
    this.notImplemented('deleteOldLogs');
  }
  async getRecent(..._args: unknown[]) {
    return [];
  }
}
