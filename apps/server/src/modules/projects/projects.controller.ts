import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ProjectsService } from './projects.service';

@Controller('projects')
@UseGuards(AuthGuard, BusinessGuard)
export class ProjectsController {
  constructor(@Inject(ProjectsService) private readonly projects: ProjectsService) {}

  @Get('businesses/:businessId')
  listProjects(@Param('businessId') businessId: string) {
    return this.projects.listProjects(businessId);
  }

  @Get('businesses/:businessId/projects/:projectId')
  getProject(
    @Param('businessId') businessId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.projects.getProject(businessId, projectId);
  }

  @Post('businesses/:businessId')
  createProject(
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
    return this.projects.createProject(businessId, body);
  }

  @Patch('businesses/:businessId/projects/:projectId')
  updateProject(
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
    return this.projects.updateProject(businessId, projectId, body);
  }

  @Delete('businesses/:businessId/projects/:projectId')
  deleteProject(
    @Param('businessId') businessId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.projects.deleteProject(businessId, projectId);
  }

  @Post('businesses/:businessId/projects/:projectId/tasks')
  addTask(
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
    return this.projects.addTask(businessId, projectId, body);
  }

  @Patch('businesses/:businessId/tasks/:taskId')
  updateTask(
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
    return this.projects.updateTask(businessId, taskId, body);
  }

  @Delete('businesses/:businessId/tasks/:taskId')
  deleteTask(
    @Param('businessId') businessId: string,
    @Param('taskId') taskId: string,
  ) {
    return this.projects.deleteTask(businessId, taskId);
  }

  @Get('businesses/:businessId/templates')
  listTemplates(@Param('businessId') businessId: string) {
    return this.projects.listTemplates(businessId);
  }

  @Post('businesses/:businessId/templates')
  createTemplate(
    @Param('businessId') businessId: string,
    @Body() body: { name: string; taskTitles: string[]; productId?: string },
  ) {
    return this.projects.createTemplate(businessId, body);
  }

  @Delete('businesses/:businessId/templates/:templateId')
  deleteTemplate(
    @Param('businessId') businessId: string,
    @Param('templateId') templateId: string,
  ) {
    return this.projects.deleteTemplate(businessId, templateId);
  }

  @Post('businesses/:businessId/from-template/:templateId')
  createFromTemplate(
    @Param('businessId') businessId: string,
    @Param('templateId') templateId: string,
    @Body() body: { name?: string; contactId?: string; invoiceId?: string; bookingId?: string },
  ) {
    return this.projects.createFromTemplate(businessId, templateId, body);
  }
}
