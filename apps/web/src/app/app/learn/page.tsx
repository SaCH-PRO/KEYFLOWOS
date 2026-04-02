"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  GraduationCap,
  BookOpen,
  Play,
  Lightbulb,
  X,
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
import { ModuleWalkthrough, WalkthroughTrigger } from "@/components/ui/module-walkthrough";
import { LEARN_WALKTHROUGH } from "@/lib/walkthrough-definitions";
import { useKeyboardShortcuts, type ShortcutGroup } from "@/hooks/use-keyboard-shortcuts";
import { useSwipeTabs } from "@/hooks/use-swipe-tabs";
import { LearnSkeleton } from "./components/learn-skeleton";
import { CourseCatalog } from "./components/course-catalog";
import { ProgressTracker } from "./components/progress-tracker";
import { LessonViewer } from "./components/lesson-viewer";

const LEARN_TABS = [
  { key: "learning", label: "My Learning", icon: Play },
  { key: "catalog", label: "Catalog", icon: BookOpen },
  { key: "certificates", label: "Certificates", icon: GraduationCap },
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
  const [showGuide, setShowGuide] = useState(false);
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
        { key: "g", description: "Toggle guide", action: () => setShowGuide((p) => !p) },
        { key: "Escape", description: "Close viewer/guide", action: () => { if (selectedCourse) closeCourseViewer(); else setShowGuide(false); } },
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
        titleExtra={
          <div className="relative flex items-center gap-2">
            <WalkthroughTrigger moduleKey="learn" />
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
                    className="fixed left-2 right-2 top-20 sm:absolute sm:left-0 sm:right-auto sm:top-full sm:mt-2 z-50 kf-card border border-border shadow-2xl rounded-2xl sm:w-[90vw] sm:max-w-[700px] max-h-[80vh] overflow-y-auto p-5"
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
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
                    <div className="mt-3 pt-3 border-t border-border/30 text-[10px] text-muted-foreground/60">
                      Keyboard: <kbd className="px-1 py-0.5 rounded bg-white/10 font-mono">1-3</kbd> tabs
                      <span className="mx-1.5">|</span>
                      <kbd className="px-1 py-0.5 rounded bg-white/10 font-mono">R</kbd> refresh
                      <span className="mx-1.5">|</span>
                      <kbd className="px-1 py-0.5 rounded bg-white/10 font-mono">G</kbd> guide
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        }
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
      <ModuleWalkthrough moduleKey="learn" steps={LEARN_WALKTHROUGH} />
    </div>
  );
}
