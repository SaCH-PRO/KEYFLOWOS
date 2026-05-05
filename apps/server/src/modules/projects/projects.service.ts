import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class ProjectsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  listProjects(businessId: string) {
    return this.prisma.client.project.findMany({
      where: { businessId, deletedAt: null },
      include: {
        tasks: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  getProject(businessId: string, projectId: string) {
    return this.prisma.client.project.findFirst({
      where: { id: projectId, businessId, deletedAt: null },
      include: {
        tasks: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } },
      },
    });
  }

  async createProject(businessId: string, body: {
    name: string;
    description?: string;
    status?: string;
    priority?: string;
    color?: string;
    contactId?: string;
    invoiceId?: string;
    bookingId?: string;
    dueDate?: string;
  }) {
    const project = await this.prisma.client.project.create({
      data: {
        businessId,
        name: body.name,
        description: body.description,
        status: body.status || 'ACTIVE',
        priority: body.priority || 'NORMAL',
        color: body.color,
        contactId: body.contactId,
        invoiceId: body.invoiceId,
        bookingId: body.bookingId,
        dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
      },
      include: { tasks: true },
    });
    this.events.emit('project.created', { project, businessId });
    return project;
  }

  async updateProject(businessId: string, projectId: string, body: {
    name?: string;
    description?: string;
    status?: string;
    priority?: string;
    color?: string;
    contactId?: string;
    invoiceId?: string;
    bookingId?: string;
    dueDate?: string | null;
  }) {
    const data: any = { ...body };
    if (body.dueDate !== undefined) {
      data.dueDate = body.dueDate ? new Date(body.dueDate) : null;
    }
    const project = await this.prisma.client.project.update({
      where: { id: projectId, businessId },
      data,
      include: { tasks: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } } },
    });
    this.events.emit('project.updated', { project, businessId });
    if (project.status === 'COMPLETED') {
      this.events.emit('project.completed', { project, businessId });
    }
    return project;
  }

  async deleteProject(businessId: string, projectId: string) {
    const result = await this.prisma.client.project.update({
      where: { id: projectId, businessId },
      data: { deletedAt: new Date() },
    });
    this.events.emit('project.deleted', { businessId, projectId });
    return result;
  }

  async addTask(businessId: string, projectId: string, body: {
    title: string;
    description?: string;
    priority?: string;
    dueDate?: string;
    assigneeId?: string;
  }) {
    const maxSort = await this.prisma.client.projectTask.aggregate({
      where: { projectId, businessId, deletedAt: null },
      _max: { sortOrder: true },
    });
    const task = await this.prisma.client.projectTask.create({
      data: {
        projectId,
        businessId,
        title: body.title,
        description: body.description,
        priority: body.priority || 'NORMAL',
        dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
        assigneeId: body.assigneeId,
        sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
      },
    });
    this.events.emit('project_task.created', { task, businessId });
    return task;
  }

  async updateTask(businessId: string, taskId: string, body: {
    title?: string;
    description?: string;
    isCompleted?: boolean;
    priority?: string;
    dueDate?: string | null;
    sortOrder?: number;
    assigneeId?: string | null;
  }) {
    const existing = await this.prisma.client.projectTask.findFirst({
      where: { id: taskId, businessId },
    });
    if (!existing) throw new NotFoundException('Task not found');
    const data: any = { ...body };
    if (body.dueDate !== undefined) {
      data.dueDate = body.dueDate ? new Date(body.dueDate) : null;
    }
    const task = await this.prisma.client.projectTask.update({
      where: { id: taskId, businessId },
      data,
    });
    this.events.emit('project_task.updated', { task, businessId });
    const prevDue = existing.dueDate?.getTime() ?? null;
    const newDue = task.dueDate?.getTime() ?? null;
    if (body.dueDate !== undefined && prevDue !== newDue) {
      this.events.emit('project_task.rescheduled', { task, businessId });
    }
    if (body.isCompleted === true && !existing.isCompleted) {
      this.events.emit('project_task.completed', { task, businessId });
    }
    return task;
  }

  async deleteTask(businessId: string, taskId: string) {
    const result = await this.prisma.client.projectTask.update({
      where: { id: taskId, businessId },
      data: { deletedAt: new Date() },
    });
    this.events.emit('project_task.deleted', { businessId, taskId });
    return result;
  }

  listTemplates(businessId: string) {
    return this.prisma.client.projectTemplate.findMany({
      where: { businessId },
      include: { product: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });
  }

  createTemplate(businessId: string, body: { name: string; taskTitles: string[]; productId?: string }) {
    return this.prisma.client.projectTemplate.create({
      data: {
        businessId,
        name: body.name,
        taskTitles: body.taskTitles,
        productId: body.productId || undefined,
      },
    });
  }

  deleteTemplate(businessId: string, templateId: string) {
    return this.prisma.client.projectTemplate.delete({
      where: { id: templateId, businessId },
    });
  }

  async createFromTemplate(businessId: string, templateId: string, body: { name?: string; contactId?: string; invoiceId?: string; bookingId?: string }) {
    const template = await this.prisma.client.projectTemplate.findFirst({
      where: { id: templateId, businessId },
    });
    if (!template) throw new NotFoundException('Template not found');

    const taskTitles = Array.isArray(template.taskTitles) ? (template.taskTitles as string[]) : [];

    const project = await this.prisma.client.project.create({
      data: {
        businessId,
        name: body.name || template.name,
        status: 'ACTIVE',
        priority: 'NORMAL',
        contactId: body.contactId,
        invoiceId: body.invoiceId,
        bookingId: body.bookingId,
        tasks: {
          create: taskTitles.map((title, i) => ({
            businessId,
            title,
            sortOrder: i + 1,
          })),
        },
      },
      include: { tasks: true },
    });
    this.events.emit('project.created', { project, businessId });
    return project;
  }
}
