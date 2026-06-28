import { Injectable } from '@nestjs/common';
import { ConnectorCommand, ConnectorResult } from '../key-cortex-connector.types';
import { connectorOk, connectorFail } from '../key-cortex-connector.utils';
import { ActivityLogService } from '../../activity/activity.service';

/**
 * Typed adapter that exposes the activity-log methods expected by
 * KeyCortexConnectorService.  Delegates to ActivityLogService.
 */
@Injectable()
export class ActivityAdapterService {
  constructor(private readonly activity: ActivityLogService) {}

  async execute(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    switch (command.action) {
      case 'log_activity': {
        const entry = await this.activity.log({
          businessId: command.businessId,
          entityType: command.parameters.entityType as string,
          entityId: command.parameters.entityId as string,
          action: command.parameters.action as string,
          description: command.parameters.description as string,
          metadata: command.parameters.metadata as Record<string, unknown>,
          source: 'key_cortex',
        });
        return connectorOk(command, start, entry);
      }
      case 'log_bulk_activity': {
        const entries = await this.activity.logBulk({
          businessId: command.businessId,
          events: command.parameters.events as Array<Record<string, unknown>>,
        });
        return connectorOk(command, start, entries);
      }
      case 'create_audit_note': {
        const note = await this.activity.createAuditNote({
          businessId: command.businessId,
          entityType: command.parameters.entityType as string,
          entityId: command.parameters.entityId as string,
          note: command.parameters.note as string,
        });
        return connectorOk(command, start, note);
      }
      case 'export_audit_log': {
        const exported = await this.activity.exportAuditLog({
          businessId: command.businessId,
          from: command.parameters.from as string,
          to: command.parameters.to as string,
          entityType: command.parameters.entityType as string,
          format: (command.parameters.format as string) || 'csv',
        });
        return connectorOk(command, start, exported);
      }
      case 'delete_old_logs': {
        const deleted = await this.activity.deleteOldLogs({
          businessId: command.businessId,
          olderThanDays: command.parameters.olderThanDays as number,
          entityType: command.parameters.entityType as string,
        });
        return connectorOk(command, start, deleted);
      }
      default:
        return connectorFail(command, start, `Unknown activity action: ${command.action}`);
    }
  }

  async getRecent(input: { businessId: string; limit?: number }) {
    return this.activity.getRecent(input);
  }
}
