"use client";

import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { BookOpen, CheckCircle2, Circle, ChevronLeft, Award } from "lucide-react";
import type { Course, CourseEnrollment } from "@/lib/client";
import { updateCourseProgress } from "@/lib/client";
import { getGradient } from "./course-card";

interface LessonViewerProps {
  course: Course;
  enrollment: CourseEnrollment | null;
  businessId: string | null;
  onBack: () => void;
  onEnrollmentUpdate: (enrollment: CourseEnrollment) => void;
}

export function LessonViewer({ course, enrollment, businessId, onBack, onEnrollmentUpdate }: LessonViewerProps) {
  const [activeLesson, setActiveLesson] = useState<string | null>(
    course.lessons?.length ? course.lessons[0].id : null
  );

  const handleMarkComplete = useCallback(async (lessonId: string) => {
    if (!businessId || !enrollment) return;
    const currentlyCompleted = enrollment.progress?.[lessonId] ?? false;
    try {
      const res = await updateCourseProgress(businessId, course.id, lessonId, !currentlyCompleted);
      if (res.data) {
        onEnrollmentUpdate(res.data);
      }
    } catch {}
  }, [businessId, enrollment, course.id, onEnrollmentUpdate]);

  const completedCount = enrollment?.progress
    ? Object.values(enrollment.progress).filter(Boolean).length
    : 0;
  const totalLessons = course.lessons?.length || 0;
  const allComplete = totalLessons > 0 && completedCount === totalLessons;
  const currentLesson = course.lessons?.find((l) => l.id === activeLesson);

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
        Back to Courses
      </button>

      <div className="flex items-center gap-3">
        <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${getGradient(course.category)} flex items-center justify-center`}>
          <BookOpen className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">{course.title}</h1>
          <p className="text-sm text-muted-foreground">
            {completedCount} of {totalLessons} lessons complete
          </p>
        </div>
      </div>

      {enrollment && (
        <div className="h-2 rounded-full bg-white/5 overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{ background: "linear-gradient(90deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}
            initial={{ width: 0 }}
            animate={{ width: `${totalLessons > 0 ? (completedCount / totalLessons) * 100 : 0}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>
      )}

      {allComplete && enrollment?.certificateId && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-r from-amber-500/10 to-yellow-500/10 border border-amber-500/20 rounded-xl p-4 flex items-center gap-3"
        >
          <Award className="w-8 h-8 text-amber-400" />
          <div>
            <p className="text-sm font-semibold text-amber-300">Course Completed!</p>
            <p className="text-xs text-muted-foreground">
              Certificate ID: {enrollment.certificateId}
            </p>
          </div>
        </motion.div>
      )}

      <div className="flex gap-4 flex-col md:flex-row">
        <div className="w-full md:w-64 flex-shrink-0 space-y-1">
          {course.lessons
            ?.sort((a, b) => a.order - b.order)
            .map((lesson) => {
              const isCompleted = enrollment?.progress?.[lesson.id] ?? false;
              const isActive = activeLesson === lesson.id;
              return (
                <button
                  key={lesson.id}
                  onClick={() => setActiveLesson(lesson.id)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg text-sm flex items-center gap-2 transition-colors ${
                    isActive
                      ? "bg-white/10 text-foreground"
                      : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                  }`}
                >
                  {isCompleted ? (
                    <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
                  ) : (
                    <Circle className="w-4 h-4 flex-shrink-0" />
                  )}
                  <span className="truncate">{lesson.title}</span>
                </button>
              );
            })}
        </div>

        <div className="flex-1 bg-white/5 backdrop-blur border border-white/10 rounded-xl p-6 min-h-[400px]">
          {currentLesson ? (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">{currentLesson.title}</h2>
              <div className="prose prose-invert prose-sm max-w-none">
                {currentLesson.content?.split("\n").map((paragraph, i) => (
                  <p key={i} className="text-sm text-muted-foreground leading-relaxed">
                    {paragraph}
                  </p>
                ))}
              </div>
              {enrollment && (
                <button
                  onClick={() => handleMarkComplete(currentLesson.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                    enrollment.progress?.[currentLesson.id]
                      ? "bg-green-500/20 text-green-400 hover:bg-green-500/30"
                      : "kf-btn-primary"
                  }`}
                >
                  {enrollment.progress?.[currentLesson.id] ? (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      Completed
                    </>
                  ) : (
                    <>
                      <Circle className="w-4 h-4" />
                      Mark Complete
                    </>
                  )}
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              Select a lesson to begin
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
