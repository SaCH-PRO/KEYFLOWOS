import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { PrismaService } from '../../core/prisma/prisma.service';

@Controller('projects')
@UseGuards(AuthGuard, BusinessGuard)
export class ProjectsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get('businesses/:businessId')
  async listProjects(@Param('businessId') businessId: string) {
    return this.prisma.client.project.findMany({
      where: { businessId, deletedAt: null },
      include: {
        tasks: {
          where: { deletedAt: null },
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get('businesses/:businessId/projects/:projectId')
  async getProject(
    @Param('businessId') businessId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.prisma.client.project.findFirst({
      where: { id: projectId, businessId, deletedAt: null },
      include: {
        tasks: {
          where: { deletedAt: null },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
  }

  @Post('businesses/:businessId')
  async createProject(
    @Param('businessId') businessId: string,
    @Body() body: {
      name: string;
      description?: string;
      status?: string;
      priority?: string;
      color?: string;
      contactId?: string;
      invoiceId?: string;
      bookingId?: string;
      dueDate?: string;
    },
  ) {
    return this.prisma.client.project.create({
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
  }

  @Patch('businesses/:businessId/projects/:projectId')
  async updateProject(
    @Param('businessId') businessId: string,
    @Param('projectId') projectId: string,
    @Body() body: {
      name?: string;
      description?: string;
      status?: string;
      priority?: string;
      color?: string;
      contactId?: string;
      invoiceId?: string;
      bookingId?: string;
      dueDate?: string | null;
    },
  ) {
    const data: any = { ...body };
    if (body.dueDate !== undefined) {
      data.dueDate = body.dueDate ? new Date(body.dueDate) : null;
    }
    return this.prisma.client.project.update({
      where: { id: projectId, businessId },
      data,
      include: { tasks: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } } },
    });
  }

  @Delete('businesses/:businessId/projects/:projectId')
  async deleteProject(
    @Param('businessId') businessId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.prisma.client.project.update({
      where: { id: projectId, businessId },
      data: { deletedAt: new Date() },
    });
  }

  @Post('businesses/:businessId/projects/:projectId/tasks')
  async addTask(
    @Param('businessId') businessId: string,
    @Param('projectId') projectId: string,
    @Body() body: {
      title: string;
      description?: string;
      priority?: string;
      dueDate?: string;
      assigneeId?: string;
    },
  ) {
    const maxSort = await this.prisma.client.projectTask.aggregate({
      where: { projectId, businessId, deletedAt: null },
      _max: { sortOrder: true },
    });
    return this.prisma.client.projectTask.create({
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
  }

  @Patch('businesses/:businessId/tasks/:taskId')
  async updateTask(
    @Param('businessId') businessId: string,
    @Param('taskId') taskId: string,
    @Body() body: {
      title?: string;
      description?: string;
      isCompleted?: boolean;
      priority?: string;
      dueDate?: string | null;
      sortOrder?: number;
      assigneeId?: string | null;
    },
  ) {
    const data: any = { ...body };
    if (body.dueDate !== undefined) {
      data.dueDate = body.dueDate ? new Date(body.dueDate) : null;
    }
    return this.prisma.client.projectTask.update({
      where: { id: taskId, businessId },
      data,
    });
  }

  @Delete('businesses/:businessId/tasks/:taskId')
  async deleteTask(
    @Param('businessId') businessId: string,
    @Param('taskId') taskId: string,
  ) {
    return this.prisma.client.projectTask.update({
      where: { id: taskId, businessId },
      data: { deletedAt: new Date() },
    });
  }
}
