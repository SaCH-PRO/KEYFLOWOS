"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  GraduationCap,
  Clock,
  Users,
  BookOpen,
  CheckCircle2,
  Circle,
  ChevronLeft,
  Award,
  Play,
  ArrowRight,
  Lightbulb,
  X,
} from "lucide-react";
import {
  fetchCourses,
  fetchCourse,
  enrollInCourse,
  updateCourseProgress,
  fetchMyEnrollments,
  Course,
  CourseEnrollment,
} from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";
import { PageHeader } from "@/components/ui/page-header";

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

function getGradient(category: string) {
  return CATEGORY_GRADIENTS[category?.toUpperCase()] || CATEGORY_GRADIENTS.DEFAULT;
}

function getProgress(enrollment: CourseEnrollment, course?: Course): number {
  if (!enrollment.progress || !course?.lessons?.length) return 0;
  const completed = Object.values(enrollment.progress).filter(Boolean).length;
  return Math.round((completed / course.lessons.length) * 100);
}

function timeAgo(minutes?: number): string {
  if (!minutes) return "";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export default function LearnPage() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [enrollments, setEnrollments] = useState<CourseEnrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [selectedEnrollment, setSelectedEnrollment] = useState<CourseEnrollment | null>(null);
  const [activeLesson, setActiveLesson] = useState<string | null>(null);
  const [enrollingId, setEnrollingId] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    const bid = getStoredBusinessId();
    if (bid) setBusinessId(bid);
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [coursesRes, enrollmentsRes] = await Promise.all([
        fetchCourses(),
        businessId ? fetchMyEnrollments(businessId) : Promise.resolve({ data: [] as CourseEnrollment[], error: null }),
      ]);
      if (coursesRes.data) setCourses(coursesRes.data);
      if (enrollmentsRes.data) setEnrollments(enrollmentsRes.data);
    } catch {}
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleEnroll = async (courseId: string) => {
    if (!businessId) return;
    setEnrollingId(courseId);
    try {
      const res = await enrollInCourse(businessId, courseId);
      if (res.data) {
        setEnrollments((prev) => [...prev, res.data!]);
      }
    } catch {}
    setEnrollingId(null);
  };

  const handleMarkComplete = async (lessonId: string) => {
    if (!businessId || !selectedCourse || !selectedEnrollment) return;
    const currentlyCompleted = selectedEnrollment.progress?.[lessonId] ?? false;
    try {
      const res = await updateCourseProgress(businessId, selectedCourse.id, lessonId, !currentlyCompleted);
      if (res.data) {
        setSelectedEnrollment(res.data);
        setEnrollments((prev) =>
          prev.map((e) => (e.id === res.data!.id ? res.data! : e))
        );
      }
    } catch {}
  };

  const openCourseViewer = async (course: Course, enrollment?: CourseEnrollment) => {
    const courseRes = await fetchCourse(course.id);
    const fullCourse = courseRes.data || course;
    setSelectedCourse(fullCourse);
    setSelectedEnrollment(enrollment || enrollments.find((e) => e.courseId === course.id) || null);
    if (fullCourse.lessons?.length) {
      setActiveLesson(fullCourse.lessons[0].id);
    }
  };

  const closeCourseViewer = () => {
    setSelectedCourse(null);
    setSelectedEnrollment(null);
    setActiveLesson(null);
  };

  const enrolledCourseIds = new Set(enrollments.map((e) => e.courseId));

  const enrolledCourses = enrollments
    .map((e) => ({
      enrollment: e,
      course: e.course || courses.find((c) => c.id === e.courseId),
    }))
    .filter((item) => item.course);

  if (selectedCourse) {
    const completedCount = selectedEnrollment?.progress
      ? Object.values(selectedEnrollment.progress).filter(Boolean).length
      : 0;
    const totalLessons = selectedCourse.lessons?.length || 0;
    const allComplete = totalLessons > 0 && completedCount === totalLessons;
    const currentLesson = selectedCourse.lessons?.find((l) => l.id === activeLesson);

    return (
      <div className="space-y-4">
        <button
          onClick={closeCourseViewer}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          Back to Courses
        </button>

        <div className="flex items-center gap-3">
          <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${getGradient(selectedCourse.category)} flex items-center justify-center`}>
            <BookOpen className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">{selectedCourse.title}</h1>
            <p className="text-sm text-muted-foreground">
              {completedCount} of {totalLessons} lessons complete
            </p>
          </div>
        </div>

        {selectedEnrollment && (
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

        {allComplete && selectedEnrollment?.certificateId && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-gradient-to-r from-amber-500/10 to-yellow-500/10 border border-amber-500/20 rounded-xl p-4 flex items-center gap-3"
          >
            <Award className="w-8 h-8 text-amber-400" />
            <div>
              <p className="text-sm font-semibold text-amber-300">Course Completed!</p>
              <p className="text-xs text-muted-foreground">
                Certificate ID: {selectedEnrollment.certificateId}
              </p>
            </div>
          </motion.div>
        )}

        <div className="flex gap-4 flex-col md:flex-row">
          <div className="w-full md:w-64 flex-shrink-0 space-y-1">
            {selectedCourse.lessons
              ?.sort((a, b) => a.order - b.order)
              .map((lesson) => {
                const isCompleted = selectedEnrollment?.progress?.[lesson.id] ?? false;
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
                {selectedEnrollment && (
                  <button
                    onClick={() => handleMarkComplete(currentLesson.id)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                      selectedEnrollment.progress?.[currentLesson.id]
                        ? "bg-green-500/20 text-green-400 hover:bg-green-500/30"
                        : "kf-btn-primary"
                    }`}
                  >
                    {selectedEnrollment.progress?.[currentLesson.id] ? (
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

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight flex items-center gap-2">
            <GraduationCap className="w-6 h-6" style={{ color: "hsl(var(--kf-accent1))" }} />
            MasterClass
          </h1>
          <p className="text-sm text-muted-foreground">Loading courses...</p>
        </div>
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border border-white/10 bg-white/5 p-4 h-64 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={GraduationCap}
        title="MasterClass"
        subtitle="Level up your business skills"
        titleExtra={
          <div className="relative">
            <button
              onClick={() => setShowGuide(!showGuide)}
              className={`w-7 h-7 rounded-full flex items-center justify-center transition-all duration-200 ${
                showGuide
                  ? "bg-amber-400 text-white shadow-md shadow-amber-400/40 scale-110"
                  : "bg-amber-400/15 text-amber-400 hover:bg-amber-400/25 hover:shadow-sm hover:shadow-amber-400/20 hover:scale-105"
              }`}
              aria-label="Getting started guide"
              title="Getting started guide"
            >
              <Lightbulb className="w-3.5 h-3.5" />
            </button>
            <AnimatePresence>
              {showGuide && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowGuide(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.12 }}
                    className="absolute left-0 top-full mt-2 z-50 kf-card border border-border shadow-2xl rounded-2xl w-[90vw] max-w-[700px] max-h-[85vh] overflow-y-auto p-5"
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <div className="p-1.5 rounded-lg bg-amber-400/10">
                        <Lightbulb className="w-4 h-4 text-amber-400" />
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold">Getting Started</h4>
                        <p className="text-[11px] text-muted-foreground">Your quick-start guide</p>
                      </div>
                      <button onClick={() => setShowGuide(false)} className="ml-auto p-1 rounded hover:bg-muted/50">
                        <X className="w-3.5 h-3.5 text-muted-foreground" />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { step: "1", title: "Browse Courses", desc: "Explore courses by difficulty level (Beginner, Intermediate, Advanced)." },
                        { step: "2", title: "Enroll", desc: "Click any course to see the curriculum, then enroll to start learning." },
                        { step: "3", title: "Complete Lessons", desc: "Work through lessons at your own pace. Your progress is saved automatically." },
                        { step: "4", title: "Earn Certificates", desc: "Complete all lessons in a course to unlock a downloadable certificate." },
                      ].map((item) => (
                        <div key={item.step} className="flex gap-2.5 p-2 rounded-xl hover:bg-muted/30 transition-colors">
                          <div className="w-5 h-5 rounded-full bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] flex items-center justify-center flex-shrink-0 text-[10px] font-bold mt-0.5">
                            {item.step}
                          </div>
                          <div>
                            <p className="text-xs font-medium">{item.title}</p>
                            <p className="text-[10px] text-muted-foreground leading-relaxed">{item.desc}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        }
      />

      {enrolledCourses.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Play className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
            My Learning
          </h2>
          <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            {enrolledCourses.map(({ enrollment, course }) => {
              if (!course) return null;
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
                      onClick={() => openCourseViewer(course, enrollment)}
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
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <BookOpen className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
          Course Catalog
        </h2>
        {courses.length === 0 ? (
          <div className="bg-white/5 backdrop-blur border border-white/10 rounded-xl p-8 text-center">
            <GraduationCap className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No courses available yet</p>
          </div>
        ) : (
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            <AnimatePresence>
              {courses.map((course, i) => {
                const isEnrolled = enrolledCourseIds.has(course.id);
                const diffColors = DIFFICULTY_COLORS[course.difficulty?.toUpperCase()] || DIFFICULTY_COLORS.BEGINNER;
                return (
                  <motion.div
                    key={course.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
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
                            onClick={() => openCourseViewer(course)}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors"
                          >
                            Continue
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        ) : (
                          <button
                            onClick={() => handleEnroll(course.id)}
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
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
