import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  listProjects(businessId: string) {
    return this.prisma.client.project.findMany({
      where: { businessId, deletedAt: null },
      include: { tasks: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  createProject(input: { businessId: string; name: string }) {
    return this.prisma.client.project.create({
      data: {
        businessId: input.businessId,
        name: input.name,
      },
      include: { tasks: true },
    });
  }

  updateProject(input: { projectId: string; name?: string; status?: string }) {
    return this.prisma.client.project.update({
      where: { id: input.projectId },
      data: {
        name: input.name ?? undefined,
        status: input.status ?? undefined,
      },
      include: { tasks: true },
    });
  }

  async deleteProject(projectId: string) {
    await this.prisma.client.project.delete({ where: { id: projectId } });
    return { success: true, id: projectId };
  }

  async createTask(input: { projectId: string; title: string; dueDate?: Date | null }) {
    const project = await this.prisma.client.project.findUnique({
      where: { id: input.projectId },
      select: { businessId: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    return this.prisma.client.projectTask.create({
      data: {
        businessId: project.businessId,
        projectId: input.projectId,
        title: input.title,
        dueDate: input.dueDate ?? null,
      },
    });
  }

  updateTask(input: { taskId: string; title?: string; dueDate?: Date | null; isCompleted?: boolean }) {
    return this.prisma.client.projectTask.update({
      where: { id: input.taskId },
      data: {
        title: input.title ?? undefined,
        dueDate: input.dueDate ?? undefined,
        isCompleted: input.isCompleted ?? undefined,
      },
    });
  }

  async deleteTask(taskId: string) {
    await this.prisma.client.projectTask.delete({ where: { id: taskId } });
    return { success: true, id: taskId };
  }

  listTemplates(businessId: string) {
    return this.prisma.client.projectTemplate.findMany({
      where: { businessId },
      orderBy: { name: 'asc' },
    });
  }

  createTemplate(input: { businessId: string; name: string; taskTitles: string[] }) {
    return this.prisma.client.projectTemplate.create({
      data: {
        businessId: input.businessId,
        name: input.name,
        taskTitles: input.taskTitles,
      },
    });
  }

  async createProjectFromTemplate(input: { businessId: string; templateId: string; name?: string }) {
    const template = await this.prisma.client.projectTemplate.findFirst({
      where: { id: input.templateId, businessId: input.businessId },
    });
    if (!template) throw new NotFoundException('Template not found');
    const name = input.name ?? template.name;
    return this.prisma.client.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: { businessId: input.businessId, name },
      });
      const taskTitles = Array.isArray(template.taskTitles) ? template.taskTitles : [];
      if (taskTitles.length) {
        await tx.projectTask.createMany({
          data: taskTitles.map((title) => ({
            businessId: input.businessId,
            projectId: project.id,
            title: String(title),
          })),
        });
      }
      return tx.project.findUnique({ where: { id: project.id }, include: { tasks: true } });
    });
  }
}
