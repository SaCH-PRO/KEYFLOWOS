"use client";

import { motion } from "framer-motion";
import { BookOpen, Award, ArrowRight } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import type { Course, CourseEnrollment } from "@/lib/client";
import { getGradient } from "./course-card";

export function getProgress(enrollment: CourseEnrollment, course?: Course): number {
  if (!enrollment.progress || !course?.lessons?.length) return 0;
  const completed = Object.values(enrollment.progress).filter(Boolean).length;
  return Math.round((completed / course.lessons.length) * 100);
}

interface EnrolledCourseItem {
  enrollment: CourseEnrollment;
  course: Course;
}

interface ProgressTrackerProps {
  enrolledCourses: EnrolledCourseItem[];
  onOpenCourse: (course: Course, enrollment: CourseEnrollment) => void;
}

export function ProgressTracker({ enrolledCourses, onOpenCourse }: ProgressTrackerProps) {
  if (enrolledCourses.length === 0) {
    return (
      <EmptyState
        icon={BookOpen}
        title="No courses started yet"
        description="Browse the catalog and enroll in a course to start tracking your progress."
        tip="Tip: Courses are self-paced — pick one and start with the first lesson anytime."
      />
    );
  }

  return (
    <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
      {enrolledCourses.map(({ enrollment, course }) => {
        const progress = getProgress(enrollment, course);
        return (
          <motion.div
            key={enrollment.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="kf-card rounded-xl p-4 space-y-3"
          >
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${getGradient(course.category)} flex items-center justify-center flex-shrink-0`}>
                <BookOpen className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold truncate">{course.title}</h3>
                <p className="text-xs text-muted-foreground">{progress}% complete</p>
              </div>
            </div>
            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${progress}%`,
                  background: "linear-gradient(90deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
                }}
              />
            </div>
            {enrollment.completedAt ? (
              <div className="flex items-center gap-1 text-xs text-green-400">
                <Award className="w-3.5 h-3.5" />
                Completed
              </div>
            ) : (
              <button
                onClick={() => onOpenCourse(course, enrollment)}
                className="kf-btn-primary w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium"
              >
                Continue Learning
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}
