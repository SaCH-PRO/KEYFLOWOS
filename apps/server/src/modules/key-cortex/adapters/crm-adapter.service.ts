import { Injectable } from '@nestjs/common';
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
}
