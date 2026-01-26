import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { CreateProjectTaskDto } from './dto/create-project-task.dto';
import { UpdateProjectTaskDto } from './dto/update-project-task.dto';
import { CreateProjectTemplateDto } from './dto/create-project-template.dto';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId')
  listProjects(@Param('businessId') businessId: string) {
    return this.projects.listProjects(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId')
  createProject(@Param('businessId') businessId: string, @Body() body: CreateProjectDto) {
    return this.projects.createProject({ businessId, name: body.name });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch(':projectId')
  updateProject(@Param('projectId') projectId: string, @Body() body: UpdateProjectDto) {
    return this.projects.updateProject({
      projectId,
      name: body.name,
      status: body.status,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete(':projectId')
  deleteProject(@Param('projectId') projectId: string) {
    return this.projects.deleteProject(projectId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post(':projectId/tasks')
  createTask(@Param('projectId') projectId: string, @Body() body: CreateProjectTaskDto) {
    return this.projects.createTask({
      projectId,
      title: body.title,
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('tasks/:taskId')
  updateTask(@Param('taskId') taskId: string, @Body() body: UpdateProjectTaskDto) {
    return this.projects.updateTask({
      taskId,
      title: body.title,
      dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
      isCompleted: body.isCompleted,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('tasks/:taskId')
  deleteTask(@Param('taskId') taskId: string) {
    return this.projects.deleteTask(taskId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/templates')
  listTemplates(@Param('businessId') businessId: string) {
    return this.projects.listTemplates(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/templates')
  createTemplate(@Param('businessId') businessId: string, @Body() body: CreateProjectTemplateDto) {
    return this.projects.createTemplate({
      businessId,
      name: body.name,
      taskTitles: body.taskTitles ?? [],
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/templates/:templateId/instantiate')
  createFromTemplate(
    @Param('businessId') businessId: string,
    @Param('templateId') templateId: string,
    @Body() body: { name?: string },
  ) {
    return this.projects.createProjectFromTemplate({
      businessId,
      templateId,
      name: body.name,
    });
  }
}
