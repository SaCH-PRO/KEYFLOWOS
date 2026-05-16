import { Module } from '@nestjs/common';
import { TaskAssignmentService } from './task-assignment.service';
import { TaskAssignmentController } from './task-assignment.controller';
import { TaskAssignmentRecommenderService } from './task-assignment-recommender.service';

@Module({
  providers: [TaskAssignmentService, TaskAssignmentRecommenderService],
  controllers: [TaskAssignmentController],
  exports: [TaskAssignmentService, TaskAssignmentRecommenderService],
})
export class TaskAssignmentModule {}
