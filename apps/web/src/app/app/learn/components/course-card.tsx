"use client";

import { motion } from "framer-motion";
import { BookOpen, Clock, Users, ArrowRight } from "lucide-react";
import type { Course } from "@/lib/client";

const DIFFICULTY_COLORS: Record<string, { bg: string; text: string }> = {
  BEGINNER: { bg: "bg-green-500/20", text: "text-green-400" },
  INTERMEDIATE: { bg: "bg-amber-500/20", text: "text-amber-400" },
  ADVANCED: { bg: "bg-red-500/20", text: "text-red-400" },
};

const CATEGORY_GRADIENTS: Record<string, string> = {
  MARKETING: "from-pink-500 to-rose-600",
  FINANCE: "from-emerald-500 to-teal-600",
  SALES: "from-blue-500 to-indigo-600",
  OPERATIONS: "from-amber-500 to-orange-600",
  LEADERSHIP: "from-purple-500 to-violet-600",
  TECHNOLOGY: "from-cyan-500 to-blue-600",
  DEFAULT: "from-slate-500 to-slate-600",
};

export function getGradient(category: string) {
  return CATEGORY_GRADIENTS[category?.toUpperCase()] || CATEGORY_GRADIENTS.DEFAULT;
}

interface CourseCardProps {
  course: Course;
  isEnrolled: boolean;
  enrollingId: string | null;
  index: number;
  onEnroll: (courseId: string) => void;
  onOpen: (course: Course) => void;
}

export function CourseCard({ course, isEnrolled, enrollingId, index, onEnroll, onOpen }: CourseCardProps) {
  const diffColors = DIFFICULTY_COLORS[course.difficulty?.toUpperCase()] || DIFFICULTY_COLORS.BEGINNER;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="kf-card rounded-xl overflow-hidden group"
    >
      <div className={`h-1 bg-gradient-to-r ${getGradient(course.category)}`} />
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold line-clamp-1">{course.title}</h3>
            {course.description && (
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{course.description}</p>
            )}
          </div>
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase flex-shrink-0 ${diffColors.bg} ${diffColors.text}`}>
            {course.difficulty}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {course.duration && (
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {course.duration}m
            </span>
          )}
          <span className="flex items-center gap-1">
            <Users className="w-3 h-3" />
            {course._count?.enrollments ?? 0} enrolled
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-white/10 text-muted-foreground uppercase">
            {course.category}
          </span>
          {isEnrolled ? (
            <button
              onClick={() => onOpen(course)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors"
            >
              Continue
              <ArrowRight className="w-3 h-3" />
            </button>
          ) : (
            <button
              onClick={() => onEnroll(course.id)}
              disabled={enrollingId === course.id}
              className="kf-btn-primary px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50"
            >
              {enrollingId === course.id ? "Enrolling..." : "Enroll"}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
