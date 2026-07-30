import { Injectable } from '@nestjs/common';
import { ConnectorCommand, ConnectorResult } from '../key-cortex-connector.types';
import { connectorOk, connectorFail } from '../key-cortex-connector.utils';
import { ProjectsService } from '../../projects/projects.service';

/**
 * Typed adapter that exposes the project methods expected by
 * KeyCortexConnectorService.  Delegates to ProjectsService where a real
 * implementation exists; otherwise returns a typed placeholder.
 */
@Injectable()
export class ProjectsAdapterService {
  constructor(private readonly projects: ProjectsService) {}

  async createProject(input: {
    businessId: string;
    name: string;
    description?: string;
    contactId?: string;
    dueDate?: string;
    priority?: string;
    assigneeId?: string;
  }) {
    return this.projects.createProject(input.businessId, {
      name: input.name,
      description: input.description,
      contactId: input.contactId,
      dueDate: input.dueDate,
      priority: input.priority?.toUpperCase() ?? 'NORMAL',
    });
  }

  async addTask(input: {
    businessId: string;
    projectId: string;
    title: string;
    description?: string;
    assigneeId?: string;
    dueDate?: string;
    priority?: string;
  }) {
    return this.projects.addTask(input.businessId, input.projectId, {
      title: input.title,
      description: input.description,
      assigneeId: input.assigneeId,
      dueDate: input.dueDate,
      priority: input.priority?.toUpperCase() ?? 'NORMAL',
    });
  }

  async updateTask(input: {
    businessId: string;
    projectId: string;
    taskId: string;
    title?: string;
    status?: string;
    assigneeId?: string;
    dueDate?: string;
  }) {
    return this.projects.updateTask(input.businessId, input.taskId, {
      title: input.title,
      assigneeId: input.assigneeId,
      dueDate: input.dueDate,
      ...(input.status ? { isCompleted: input.status.toLowerCase() === 'done' } : {}),
    });
  }

  async completeTask(input: {
    businessId: string;
    projectId: string;
    taskId: string;
    notes?: string;
  }) {
    return this.projects.updateTaskStatus(input.businessId, input.taskId, 'DONE');
  }

  async deleteProject(input: { businessId: string; projectId: string }) {
    return this.projects.deleteProject(input.businessId, input.projectId);
  }

  async addMilestone(input: {
    businessId: string;
    projectId: string;
    name: string;
    dueDate?: string;
    description?: string;
  }) {
    return this.projects.createMilestone(input.projectId, input.businessId, {
      title: input.name,
      description: input.description,
      dueDate: input.dueDate,
    });
  }

  async completeMilestone(input: {
    businessId: string;
    projectId: string;
    milestoneId: string;
    notes?: string;
  }) {
    return this.projects.updateMilestone(
      input.milestoneId,
      input.projectId,
      input.businessId,
      { completedAt: new Date().toISOString() },
    );
  }

  async archiveProject(input: { businessId: string; projectId: string }) {
    return this.projects.updateProject(input.businessId, input.projectId, {
      status: 'ARCHIVED',
    });
  }

  async getProjects(input: { businessId: string; status?: string }) {
    const projects = await this.projects.listProjects(input.businessId);
    if (input.status) {
      return projects.filter(
        (p: { status?: string }) =>
          p.status?.toLowerCase() === input.status?.toLowerCase(),
      );
    }
    return projects;
  }

  async getOverdueTasks(input: { businessId: string }) {
    const projects = await this.projects.listProjects(input.businessId);
    const tasks: Array<Record<string, unknown>> = [];
    const now = new Date();
    for (const project of projects as Array<{ tasks?: Array<{ dueDate?: Date; isCompleted?: boolean; [key: string]: unknown }> }>) {
      for (const task of project.tasks ?? []) {
        if (!task.isCompleted && task.dueDate && new Date(task.dueDate) < now) {
          tasks.push(task as Record<string, unknown>);
        }
      }
    }
    return tasks;
  }

  async execute(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    switch (command.action) {
      case 'create_project': {
        const project = await this.createProject({
          businessId: command.businessId,
          name: command.parameters.name as string,
          description: command.parameters.description as string,
          contactId: command.parameters.contactId as string,
          dueDate: command.parameters.dueDate as string,
          priority: (command.parameters.priority as string) || 'medium',
          assigneeId: command.parameters.assigneeId as string,
        });
        return connectorOk(command, start, project);
      }
      case 'add_task': {
        const task = await this.addTask({
          businessId: command.businessId,
          projectId: command.parameters.projectId as string,
          title: command.parameters.title as string,
          description: command.parameters.description as string,
          assigneeId: command.parameters.assigneeId as string,
          dueDate: command.parameters.dueDate as string,
          priority: (command.parameters.priority as string) || 'medium',
        });
        return connectorOk(command, start, task);
      }
      case 'update_task': {
        const updated = await this.updateTask({
          businessId: command.businessId,
          projectId: command.parameters.projectId as string,
          taskId: command.parameters.taskId as string,
          title: command.parameters.title as string,
          status: command.parameters.status as string,
          assigneeId: command.parameters.assigneeId as string,
          dueDate: command.parameters.dueDate as string,
        });
        return connectorOk(command, start, updated);
      }
      case 'complete_task': {
        const completed = await this.completeTask({
          businessId: command.businessId,
          projectId: command.parameters.projectId as string,
          taskId: command.parameters.taskId as string,
          notes: command.parameters.notes as string,
        });
        return connectorOk(command, start, completed);
      }
      case 'delete_project': {
        await this.deleteProject({
          businessId: command.businessId,
          projectId: command.parameters.projectId as string,
        });
        return connectorOk(command, start, { deleted: true });
      }
      case 'add_milestone': {
        const milestone = await this.addMilestone({
          businessId: command.businessId,
          projectId: command.parameters.projectId as string,
          name: command.parameters.name as string,
          dueDate: command.parameters.dueDate as string,
          description: command.parameters.description as string,
        });
        return connectorOk(command, start, milestone);
      }
      case 'complete_milestone': {
        const completed = await this.completeMilestone({
          businessId: command.businessId,
          projectId: command.parameters.projectId as string,
          milestoneId: command.parameters.milestoneId as string,
          notes: command.parameters.notes as string,
        });
        return connectorOk(command, start, completed);
      }
      case 'archive_project': {
        const archived = await this.archiveProject({
          businessId: command.businessId,
          projectId: command.parameters.projectId as string,
        });
        return connectorOk(command, start, archived);
      }
      default:
        return connectorFail(command, start, `Unknown projects action: ${command.action}`);
    }
  }
}
