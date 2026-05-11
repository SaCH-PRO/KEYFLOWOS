// @keyflow:dormant — learn module, gated by featureFlags.learning (KEY-9 cleanup target).
"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { DormantRoute } from "@/components/dormant-route";
import {
  GraduationCap,
  BookOpen,
  Play,
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
    >
      {tab === "learning" && (
        <div data-walkthrough="learn-progress">
          <ProgressTracker
            enrolledCourses={enrolledCourses}
            onOpenCourse={openCourseViewer}
          />
        </div>
      )}

      {tab === "catalog" && (
        <div data-walkthrough="learn-catalog">
          <CourseCatalog
            courses={courses}
            enrolledCourseIds={enrolledCourseIds}
            enrollingId={enrollingId}
            onEnroll={handleEnroll}
            onOpenCourse={(course) => openCourseViewer(course)}
          />
        </div>
      )}

      {tab === "certificates" && (
        <div data-walkthrough="learn-certificates">
          <ProgressTracker
            enrolledCourses={completedCourses}
            onOpenCourse={openCourseViewer}
          />
        </div>
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
