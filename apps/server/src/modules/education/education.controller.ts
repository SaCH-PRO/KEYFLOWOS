import { Body, Controller, Get, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { EducationService } from './education.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';

@Controller()
export class EducationController {
  constructor(
    @Inject(EducationService) private readonly education: EducationService,
  ) {}

  @Get('education/courses')
  listCourses(
    @Query('category') category?: string,
    @Query('difficulty') difficulty?: string,
  ) {
    return this.education.listCourses({ category, difficulty });
  }

  @Get('education/courses/:id')
  getCourse(@Param('id') id: string) {
    return this.education.getCourse(id);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/education/enroll/:courseId')
  enrollInCourse(
    @Param('businessId') businessId: string,
    @Param('courseId') courseId: string,
  ) {
    return this.education.enrollInCourse(businessId, courseId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/education/progress/:courseId')
  updateProgress(
    @Param('businessId') businessId: string,
    @Param('courseId') courseId: string,
    @Body() body: { lessonId: string; completed: boolean },
  ) {
    return this.education.updateProgress(businessId, courseId, body.lessonId, body.completed);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/education/enrollments')
  getMyEnrollments(@Param('businessId') businessId: string) {
    return this.education.getMyEnrollments(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/education/certificate/:courseId')
  getCertificate(
    @Param('businessId') businessId: string,
    @Param('courseId') courseId: string,
  ) {
    return this.education.getCertificate(businessId, courseId);
  }
}
