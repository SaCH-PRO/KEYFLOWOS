import { describe, expect, it } from 'vitest';
import { TaskAssignmentController } from './task-assignment.controller';
import { TaskAssignmentService } from './task-assignment.service';
import { TaskAssignmentRecommenderService } from './task-assignment-recommender.service';

function createMockAssignmentService(): any {
  return {
    assign: async () => ({ id: 'ta_1', taskId: 'task_1', assignableId: 'user_1' }),
    unassign: async () => ({ id: 'ta_1', unassignedAt: new Date() }),
    bulkAssign: async () => [{ success: true, taskId: 'task_1' }],
    transferAssignments: async () => ({ transferred: 1, assignments: [] }),
    getAssignmentsForTask: async () => [],
    getTasksForAssignee: async () => ({ items: [], total: 0 }),
    getAssignableOptions: async () => [{ type: 'User', id: 'user_1', name: 'Alice' }],
  };
}

function createMockRecommenderService(): any {
  return {
    recommend: async () => ({
      recommendations: [
        { assignableType: 'User', assignableId: 'user_1', name: 'Alice', score: 95, reason: 'light workload' },
      ],
    }),
  };
}

describe('TaskAssignmentController', () => {
  const service = createMockAssignmentService();
  const recommender = createMockRecommenderService();
  const controller = new TaskAssignmentController(service, recommender);

  it('assigns a task', async () => {
    const result = await controller.assign('biz_1', {
      taskType: 'ContactTask',
      taskId: 'task_1',
      assignableType: 'User',
      assignableId: 'user_1',
    } as any, { user: { id: 'admin' } } as any);

    expect(result.taskId).toBe('task_1');
  });

  it('unassigns a task', async () => {
    const result = await controller.unassign('biz_1', {
      taskType: 'ContactTask',
      taskId: 'task_1',
      assignableType: 'User',
      assignableId: 'user_1',
    } as any, { user: { id: 'admin' } } as any);

    expect(result.unassignedAt).toBeInstanceOf(Date);
  });

  it('transfers assignments', async () => {
    const result = await controller.transfer('biz_1', {
      fromType: 'User',
      fromId: 'user_1',
      toType: 'User',
      toId: 'user_2',
    } as any, { user: { id: 'admin' } } as any);

    expect(result.transferred).toBe(1);
  });

  it('gets recommendations', async () => {
    const result = await controller.recommend('biz_1', { taskType: 'ContactTask', taskTitle: 'Follow up' });
    expect(result.recommendations[0].score).toBe(95);
  });
});
