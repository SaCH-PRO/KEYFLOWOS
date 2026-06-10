// @keyflow:dormant — learn module, gated by featureFlags.learning (KEY-9 cleanup target).
"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import { DormantRoute } from "@/components/dormant-route";
import {
  GraduationCap,
  BookOpen,
  Play,
  Trophy,
  Clock,
  Sparkles,
} from "lucide-react";
import {
  fetchCourses,
  fetchCourse,
  enrollInCourse,
  fetchMyEnrollments,
  Course,
  CourseEnrollment,
} from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { MetricCard } from "@/components/ui/metric-card";
import { SectionCard } from "@/components/ui/section-card";
import { NotesTrigger } from "@/components/keyflow/notes-trigger";
import { useKeyboardShortcuts, type ShortcutGroup } from "@/hooks/use-keyboard-shortcuts";
import { LearnSkeleton } from "./components/learn-skeleton";
import { CourseCatalog } from "./components/course-catalog";
import { ProgressTracker } from "./components/progress-tracker";
import { LessonViewer } from "./components/lesson-viewer";

const LEARN_TABS = [
  { key: "learning", label: "My Learning", icon: Play, tooltip: "Continue courses you've started and track your progress." },
  { key: "catalog", label: "Catalog", icon: BookOpen, tooltip: "Browse all available courses and masterclasses." },
  { key: "certificates", label: "Certificates", icon: GraduationCap, tooltip: "View and download certificates for completed courses." },
];

const _LEARN_TAB_KEYS = LEARN_TABS.map((t) => t.key);

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 24 } },
};

function LearnPageInner() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [enrollments, setEnrollments] = useState<CourseEnrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [selectedEnrollment, setSelectedEnrollment] = useState<CourseEnrollment | null>(null);
  const [enrollingId, setEnrollingId] = useState<string | null>(null);
  const [tab, setTab] = useState("learning");

  useEffect(() => {
    const bid = getStoredBusinessId();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs external or derived state into local component state
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs external or derived state into local component state
    void loadData();
  }, [loadData]);

  const handleEnroll = useCallback(async (courseId: string) => {
    if (!businessId) return;
    setEnrollingId(courseId);
    try {
      const res = await enrollInCourse(businessId, courseId);
      if (res.data) {
        setEnrollments((prev) => [...prev, res.data!]);
      }
    } catch {}
    setEnrollingId(null);
  }, [businessId]);

  const openCourseViewer = useCallback(async (course: Course, enrollment?: CourseEnrollment) => {
    const courseRes = await fetchCourse(course.id);
    const fullCourse = courseRes.data || course;
    setSelectedCourse(fullCourse);
    setSelectedEnrollment(enrollment || enrollments.find((e) => e.courseId === course.id) || null);
  }, [enrollments]);

  const closeCourseViewer = useCallback(() => {
    setSelectedCourse(null);
    setSelectedEnrollment(null);
  }, []);

  const handleEnrollmentUpdate = useCallback((updated: CourseEnrollment) => {
    setSelectedEnrollment(updated);
    setEnrollments((prev) =>
      prev.map((e) => (e.id === updated.id ? updated : e))
    );
  }, []);

  const handleTabChange = useCallback((t: string) => {
    setTab(t);
  }, []);

  const enrolledCourseIds = useMemo(() => new Set(enrollments.map((e) => e.courseId)), [enrollments]);

  const enrolledCourses = useMemo(() =>
    enrollments
      .map((e) => ({
        enrollment: e,
        course: (e.course || courses.find((c) => c.id === e.courseId)) as Course,
      }))
      .filter((item) => item.course),
    [enrollments, courses]
  );

  const completedCourses = useMemo(() =>
    enrolledCourses.filter((item) => item.enrollment.completedAt),
    [enrolledCourses]
  );

  const totalHours = useMemo(() =>
    enrolledCourses.reduce((sum, item) => sum + (item.course.duration ?? 0), 0),
    [enrolledCourses]
  );

  const learnShortcuts = useMemo<ShortcutGroup[]>(() => [
    {
      groupName: "Learn Navigation",
      shortcuts: [
        { key: "1", description: "My Learning tab", action: () => handleTabChange("learning") },
        { key: "2", description: "Catalog tab", action: () => handleTabChange("catalog") },
        { key: "3", description: "Certificates tab", action: () => handleTabChange("certificates") },
        { key: "r", description: "Refresh courses", action: () => { void loadData(); } },
        { key: "Escape", description: "Close viewer", action: () => { if (selectedCourse) closeCourseViewer(); } },
      ],
    },
  ], [handleTabChange, loadData, selectedCourse, closeCourseViewer]);

  useKeyboardShortcuts(learnShortcuts, !loading);

  if (selectedCourse) {
    return (
      <LessonViewer
        course={selectedCourse}
        enrollment={selectedEnrollment}
        businessId={businessId}
        onBack={closeCourseViewer}
        onEnrollmentUpdate={handleEnrollmentUpdate}
      />
    );
  }

  if (loading) {
    return <LearnSkeleton />;
  }

  return (
    <WorkspaceShell
      icon={GraduationCap}
      title="MasterClass"
      subtitle="Level up your business skills"
      tabs={LEARN_TABS}
      activeTab={tab}
      onTabChange={handleTabChange}
      tabLayoutId="learn-tab"
      enableSwipe
      enableSlideAnimation
      headerRight={<NotesTrigger pageKey="learn" variant="header" />}
      metricStrip={
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <motion.div variants={fadeUp} initial="hidden" animate="show">
            <MetricCard label="Total Courses" value={courses.length} icon={BookOpen} />
          </motion.div>
          <motion.div variants={fadeUp} initial="hidden" animate="show" transition={{ delay: 0.05 }}>
            <MetricCard label="Enrolled" value={enrolledCourses.length} icon={Play} iconColor="#3b82f6" />
          </motion.div>
          <motion.div variants={fadeUp} initial="hidden" animate="show" transition={{ delay: 0.1 }}>
            <MetricCard label="Completed" value={completedCourses.length} icon={Trophy} iconColor="#f59e0b" />
          </motion.div>
          <motion.div variants={fadeUp} initial="hidden" animate="show" transition={{ delay: 0.15 }}>
            <MetricCard label="Hours Learned" value={`${Math.round(totalHours / 60)}h`} icon={Clock} iconColor="#10b981" />
          </motion.div>
        </div>
      }
    >
      {tab === "learning" && (
        <SectionCard title="Continue Learning" icon={Sparkles} compact noPadding>
          <div data-walkthrough="learn-progress" className="p-3">
            <ProgressTracker
              enrolledCourses={enrolledCourses}
              onOpenCourse={openCourseViewer}
            />
          </div>
        </SectionCard>
      )}

      {tab === "catalog" && (
        <SectionCard title="Course Catalog" icon={BookOpen} compact noPadding>
          <div data-walkthrough="learn-catalog" className="p-3">
            <CourseCatalog
              courses={courses}
              enrolledCourseIds={enrolledCourseIds}
              enrollingId={enrollingId}
              onEnroll={handleEnroll}
              onOpenCourse={(course) => openCourseViewer(course)}
            />
          </div>
        </SectionCard>
      )}

      {tab === "certificates" && (
        <SectionCard title="Your Certificates" icon={Trophy} compact noPadding>
          <div data-walkthrough="learn-certificates" className="p-3">
            <ProgressTracker
              enrolledCourses={completedCourses}
              onOpenCourse={openCourseViewer}
            />
          </div>
        </SectionCard>
      )}
    </WorkspaceShell>
  );
}

export default function LearnPage() {
  return (
    <DormantRoute featureKey="nav.public.learn" title="Learn">
      <LearnPageInner />
    </DormantRoute>
  );
}
