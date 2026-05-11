// @keyflow:dormant
"use client";

import { AnimatePresence } from "framer-motion";
import { GraduationCap } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import type { Course } from "@/lib/client";
import { CourseCard } from "./course-card";

interface CourseCatalogProps {
  courses: Course[];
  enrolledCourseIds: Set<string>;
  enrollingId: string | null;
  onEnroll: (courseId: string) => void;
  onOpenCourse: (course: Course) => void;
}

export function CourseCatalog({ courses, enrolledCourseIds, enrollingId, onEnroll, onOpenCourse }: CourseCatalogProps) {
  if (courses.length === 0) {
    return (
      <EmptyState
        icon={GraduationCap}
        title="No courses available yet"
        description="Check back soon — new courses are added regularly to help you grow your business skills."
        tip="Tip: New courses cover topics like pricing strategy, client retention, and marketing automation."
      />
    );
  }

  return (
    <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
      <AnimatePresence>
        {courses.map((course, i) => (
          <CourseCard
            key={course.id}
            course={course}
            isEnrolled={enrolledCourseIds.has(course.id)}
            enrollingId={enrollingId}
            index={i}
            onEnroll={onEnroll}
            onOpen={onOpenCourse}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}