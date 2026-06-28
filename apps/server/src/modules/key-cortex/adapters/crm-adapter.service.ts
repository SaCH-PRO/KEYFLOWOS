import { Injectable } from '@nestjs/common';
import { ConnectorCommand, ConnectorResult } from '../key-cortex-connector.types';
import { connectorOk, connectorFail } from '../key-cortex-connector.utils';
import { CrmService } from '../../crm/crm.service';

/**
 * Typed adapter that exposes the CRM methods expected by
 * KeyCortexConnectorService.  Delegates to CrmService where a real
 * implementation exists; otherwise returns a typed placeholder or
 * throws NotImplementedException.
 */
@Injectable()
export class CrmAdapterService {
  constructor(private readonly crm: CrmService) {}

  async createContact(input: {
    businessId: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    company?: string;
    tags?: string[];
    status?: string;
    source?: string;
  }) {
    return this.crm.createContact({
      businessId: input.businessId,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone,
      companyName: input.company,
      tags: input.tags,
      status: input.status,
      source: input.source ?? 'key_cortex',
    });
  }

  async contactDetail(input: { businessId: string; contactId: string }) {
    return this.crm.contactDetail(input);
  }

  async updateContact(input: {
    businessId: string;
    contactId: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    status?: string;
    tags?: string[];
  }) {
    return this.crm.updateContact({
      businessId: input.businessId,
      contactId: input.contactId,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone,
      status: input.status,
      tags: input.tags,
    });
  }

  async deleteContact(input: { businessId: string; contactId: string }) {
    return this.crm.softDeleteContact({
      businessId: input.businessId,
      contactId: input.contactId,
    });
  }

  async listContacts(input: {
    businessId: string;
    status?: string;
    tag?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }) {
    const result = await this.crm.listContacts({
      businessId: input.businessId,
      status: input.status,
      search: input.search,
      tags: input.tag ? [input.tag] : undefined,
      take: input.limit ?? 50,
      skip: input.offset ?? 0,
    });
    return (result as { contacts?: unknown[] }).contacts ?? [];
  }

  async addTask(input: {
    businessId: string;
    contactId: string;
    title: string;
    priority?: string;
    dueDate?: string;
    assignedTo?: string;
    source?: string;
  }) {
    return this.crm.addTask({
      businessId: input.businessId,
      contactId: input.contactId,
      title: input.title,
      priority: input.priority,
      dueDate: input.dueDate,
      assigneeId: input.assignedTo,
      source: input.source ?? 'key_cortex',
    });
  }

  async completeTask(input: {
    businessId: string;
    taskId: string;
    contactId?: string;
    notes?: string;
  }) {
    return this.crm.completeTask({
      businessId: input.businessId,
      taskId: input.taskId,
    });
  }

  async addNote(input: {
    businessId: string;
    contactId: string;
    body: string;
    type?: string;
  }) {
    return this.crm.addNote({
      businessId: input.businessId,
      contactId: input.contactId,
      body: input.body,
      source: input.type ?? 'key_cortex',
    });
  }

  async addTag(input: {
    businessId: string;
    contactId: string;
    tags: string[];
  }) {
    const detail = await this.contactDetail(input);
    const existing = Array.isArray((detail as { contact?: { tags?: string[] } })?.contact?.tags)
      ? (detail as { contact: { tags: string[] } }).contact.tags
      : [];
    const merged = Array.from(new Set([...existing, ...input.tags]));
    return this.updateContact({
      businessId: input.businessId,
      contactId: input.contactId,
      tags: merged,
    });
  }

  async updateContactStatus(input: {
    businessId: string;
    contactId: string;
    status: string;
    reason?: string;
  }) {
    return this.updateContact({
      businessId: input.businessId,
      contactId: input.contactId,
      status: input.status,
    });
  }

  async logEvent(input: {
    businessId: string;
    contactId: string;
    eventType: string;
    metadata?: Record<string, unknown>;
  }) {
    return this.crm.logContactEvent({
      businessId: input.businessId,
      contactId: input.contactId,
      type: input.eventType,
      data: input.metadata ?? {},
      actorType: 'SYSTEM',
      source: 'key_cortex',
    });
  }

  async mergeContacts(input: {
    businessId: string;
    masterContactId: string;
    duplicateContactId: string;
  }) {
    return this.crm.mergeContacts({
      businessId: input.businessId,
      primaryId: input.masterContactId,
      duplicateId: input.duplicateContactId,
    });
  }

  async getOpenTasks(input: { businessId: string }) {
    return this.crm.listContactTasks({
      businessId: input.businessId,
      status: 'OPEN',
    });
  }

  async execute(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    switch (command.action) {
      case 'create_contact': {
        const contact = await this.createContact({
          businessId: command.businessId,
          firstName: command.parameters.firstName as string,
          lastName: command.parameters.lastName as string,
          email: command.parameters.email as string,
          phone: command.parameters.phone as string,
          company: command.parameters.company as string,
          tags: command.parameters.tags as string[],
          status: (command.parameters.status as string) || 'lead',
          source: 'key_cortex',
        });
        return connectorOk(command, start, contact);
      }
      case 'get_contact': {
        const result = await this.contactDetail({
          businessId: command.businessId,
          contactId: command.parameters.contactId as string,
        });
        return connectorOk(command, start, (result as { contact?: unknown }).contact);
      }
      case 'update_contact': {
        const updated = await this.updateContact({
          businessId: command.businessId,
          contactId: command.parameters.contactId as string,
          firstName: command.parameters.firstName as string,
          lastName: command.parameters.lastName as string,
          email: command.parameters.email as string,
          phone: command.parameters.phone as string,
          status: command.parameters.status as string,
          tags: command.parameters.tags as string[],
        });
        return connectorOk(command, start, updated);
      }
      case 'delete_contact': {
        await this.deleteContact({
          businessId: command.businessId,
          contactId: command.parameters.contactId as string,
        });
        return connectorOk(command, start, { deleted: true });
      }
      case 'list_contacts': {
        const contacts = await this.listContacts({
          businessId: command.businessId,
          status: command.parameters.status as string,
          tag: command.parameters.tag as string,
          search: command.parameters.search as string,
          limit: (command.parameters.limit as number) || 50,
          offset: (command.parameters.offset as number) || 0,
        });
        return connectorOk(command, start, contacts);
      }
      case 'add_task': {
        const task = await this.addTask({
          businessId: command.businessId,
          contactId: command.parameters.contactId as string,
          title: command.parameters.title as string,
          priority: (command.parameters.priority as string) || 'medium',
          dueDate: command.parameters.dueDate as string,
          assignedTo: command.parameters.assignedTo as string,
          source: 'key_cortex',
        });
        return connectorOk(command, start, task);
      }
      case 'complete_task': {
        const completed = await this.completeTask({
          businessId: command.businessId,
          taskId: command.parameters.taskId as string,
          contactId: command.parameters.contactId as string,
          notes: command.parameters.notes as string,
        });
        return connectorOk(command, start, completed);
      }
      case 'add_note': {
        const note = await this.addNote({
          businessId: command.businessId,
          contactId: command.parameters.contactId as string,
          body: command.parameters.body as string,
          type: (command.parameters.type as string) || 'general',
        });
        return connectorOk(command, start, note);
      }
      case 'add_tag': {
        const tagged = await this.addTag({
          businessId: command.businessId,
          contactId: command.parameters.contactId as string,
          tags: command.parameters.tags as string[],
        });
        return connectorOk(command, start, tagged);
      }
      case 'update_status': {
        const statusUpdated = await this.updateContactStatus({
          businessId: command.businessId,
          contactId: command.parameters.contactId as string,
          status: command.parameters.status as string,
          reason: command.parameters.reason as string,
        });
        return connectorOk(command, start, statusUpdated);
      }
      case 'log_event': {
        const event = await this.logEvent({
          businessId: command.businessId,
          contactId: command.parameters.contactId as string,
          eventType: command.parameters.eventType as string,
          metadata: command.parameters.metadata as Record<string, unknown>,
        });
        return connectorOk(command, start, event);
      }
      case 'merge_contacts': {
        const merged = await this.mergeContacts({
          businessId: command.businessId,
          masterContactId: command.parameters.masterContactId as string,
          duplicateContactId: command.parameters.duplicateContactId as string,
        });
        return connectorOk(command, start, merged);
      }
      default:
        return connectorFail(command, start, `Unknown CRM action: ${command.action}`);
    }
  }
}
