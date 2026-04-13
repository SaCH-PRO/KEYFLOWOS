"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
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
import { PageHeader } from "@/components/ui/page-header";
import { TabNav } from "@/components/ui/tab-nav";
import { PageGuide, PageGuideTrigger } from "@/components/ui/page-guide";
import { LEARN_WALKTHROUGH } from "@/lib/walkthrough-definitions";
import { useKeyboardShortcuts, type ShortcutGroup } from "@/hooks/use-keyboard-shortcuts";
import { useSwipeTabs } from "@/hooks/use-swipe-tabs";
import { LearnSkeleton } from "./components/learn-skeleton";
import { CourseCatalog } from "./components/course-catalog";
import { ProgressTracker } from "./components/progress-tracker";
import { LessonViewer } from "./components/lesson-viewer";

const LEARN_TABS = [
  { key: "learning", label: "My Learning", icon: Play, tooltip: "Continue courses you've started and track your progress." },
  { key: "catalog", label: "Catalog", icon: BookOpen, tooltip: "Browse all available courses and masterclasses." },
  { key: "certificates", label: "Certificates", icon: GraduationCap, tooltip: "View and download certificates for completed courses." },
];

const LEARN_TAB_KEYS = LEARN_TABS.map((t) => t.key);

export default function LearnPage() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [enrollments, setEnrollments] = useState<CourseEnrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [selectedEnrollment, setSelectedEnrollment] = useState<CourseEnrollment | null>(null);
  const [enrollingId, setEnrollingId] = useState<string | null>(null);
  const [tab, setTab] = useState("learning");
  const [slideDirection, setSlideDirection] = useState(0);

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
    if (t === tab) return;
    const oldIndex = LEARN_TAB_KEYS.indexOf(tab);
    const newIndex = LEARN_TAB_KEYS.indexOf(t);
    setSlideDirection(newIndex > oldIndex ? 1 : -1);
    setTab(t);
  }, [tab]);

  const { swipeHandlers } = useSwipeTabs({
    tabs: LEARN_TAB_KEYS,
    activeTab: tab,
    onTabChange: handleTabChange,
  });

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
    <div className="space-y-6">
      <PageHeader
        icon={GraduationCap}
        title="MasterClass"
        subtitle="Level up your business skills"
        titleExtra={<PageGuideTrigger moduleKey="learn" />}
      />

      <TabNav
        tabs={LEARN_TABS}
        activeTab={tab}
        onTabChange={handleTabChange}
        layoutId="learn-tab"
      />

      <div {...swipeHandlers} className="touch-pan-y">
        <AnimatePresence mode="wait" custom={slideDirection}>
          {tab === "learning" && (
            <motion.div
              key="learning"
              custom={slideDirection}
              initial={{ opacity: 0, x: slideDirection * 60 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: slideDirection * -60 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              data-walkthrough="learn-progress"
            >
              <ProgressTracker
                enrolledCourses={enrolledCourses}
                onOpenCourse={openCourseViewer}
              />
            </motion.div>
          )}

          {tab === "catalog" && (
            <motion.div
              key="catalog"
              custom={slideDirection}
              initial={{ opacity: 0, x: slideDirection * 60 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: slideDirection * -60 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              data-walkthrough="learn-catalog"
            >
              <CourseCatalog
                courses={courses}
                enrolledCourseIds={enrolledCourseIds}
                enrollingId={enrollingId}
                onEnroll={handleEnroll}
                onOpenCourse={(course) => openCourseViewer(course)}
              />
            </motion.div>
          )}

          {tab === "certificates" && (
            <motion.div
              key="certificates"
              custom={slideDirection}
              initial={{ opacity: 0, x: slideDirection * 60 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: slideDirection * -60 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              data-walkthrough="learn-certificates"
            >
              <ProgressTracker
                enrolledCourses={completedCourses}
                onOpenCourse={openCourseViewer}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <PageGuide
        moduleKey="learn"
        walkthroughSteps={LEARN_WALKTHROUGH}
      />
    </div>
  );
}
