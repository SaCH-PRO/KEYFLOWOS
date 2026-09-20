import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { EducationService } from './education.service';

function makeService() {
  const prisma = {
    client: {
      course: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      courseEnrollment: {
        create: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        findMany: vi.fn(),
      },
    },
  };
  return { service: new EducationService(prisma as never), prisma };
}

describe('EducationService tenant visibility', () => {
  it('keeps the public catalogue platform-only', async () => {
    const { service, prisma } = makeService();
    prisma.client.course.findMany.mockResolvedValue([]);

    await service.listCourses({ category: 'Finance' });

    expect(prisma.client.course.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isPublished: true,
          businessId: null,
          category: 'Finance',
        }),
      }),
    );
  });

  it('keeps public course lookup platform-only', async () => {
    const { service, prisma } = makeService();
    prisma.client.course.findFirst.mockResolvedValue(null);

    await service.getCourse('course_1');

    expect(prisma.client.course.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'course_1', businessId: null, isPublished: true },
      }),
    );
  });

  it('allows enrollment only into a published platform course or the caller tenant course', async () => {
    const { service, prisma } = makeService();
    prisma.client.course.findFirst.mockResolvedValue({ id: 'course_1' });
    prisma.client.courseEnrollment.create.mockResolvedValue({ id: 'enrollment_1' });

    await service.enrollInCourse('biz_a', 'course_1');

    expect(prisma.client.course.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'course_1',
        isPublished: true,
        OR: [{ businessId: null }, { businessId: 'biz_a' }],
      },
      select: { id: true },
    });
    expect(prisma.client.courseEnrollment.create).toHaveBeenCalled();
  });

  it('rejects enrollment when the course is outside the caller tenant', async () => {
    const { service, prisma } = makeService();
    prisma.client.course.findFirst.mockResolvedValue(null);

    await expect(service.enrollInCourse('biz_a', 'course_b')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.client.courseEnrollment.create).not.toHaveBeenCalled();
  });
});
