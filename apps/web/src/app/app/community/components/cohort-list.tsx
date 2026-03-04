"use client";

import { motion } from "framer-motion";
import { Users, UserPlus, UserMinus } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import type { Cohort } from "@/lib/client";
import { CohortsSkeleton } from "./community-skeleton";

interface CohortListProps {
  cohorts: Cohort[];
  myCohorts: Cohort[];
  loading: boolean;
  joiningCohort: string | null;
  onJoin: (cohortId: string) => void;
  onLeave: (cohortId: string) => void;
}

export function CohortList({ cohorts, myCohorts, loading, joiningCohort, onJoin, onLeave }: CohortListProps) {
  const myCohortIds = new Set(myCohorts.map((c) => c.id));

  return (
    <div className="space-y-6">
      {myCohorts.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Users className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
            My Cohorts
          </h2>
          <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            {myCohorts.map((cohort) => (
              <motion.div
                key={cohort.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white/5 backdrop-blur border border-white/10 rounded-xl p-4 space-y-3"
              >
                <h3 className="text-sm font-semibold">{cohort.name}</h3>
                {cohort.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{cohort.description}</p>
                )}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      {cohort._count?.members ?? 0} / {cohort.maxMembers}
                    </span>
                    {cohort.industry && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] bg-white/10 text-muted-foreground">
                        {cohort.industry}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => onLeave(cohort.id)}
                    disabled={joiningCohort === cohort.id}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors disabled:opacity-50"
                  >
                    <UserMinus className="w-3 h-3" />
                    Leave
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">All Cohorts</h2>
        {loading ? (
          <CohortsSkeleton />
        ) : cohorts.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No cohorts available"
            description="Founder circles and cohorts will appear here once they're created."
          />
        ) : (
          <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            {cohorts.map((cohort, i) => {
              const isMember = myCohortIds.has(cohort.id);
              const isFull = (cohort._count?.members ?? 0) >= cohort.maxMembers;
              return (
                <motion.div
                  key={cohort.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="bg-white/5 backdrop-blur border border-white/10 rounded-xl p-4 space-y-3"
                >
                  <h3 className="text-sm font-semibold">{cohort.name}</h3>
                  {cohort.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2">{cohort.description}</p>
                  )}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {cohort._count?.members ?? 0} / {cohort.maxMembers}
                      </span>
                      {cohort.industry && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] bg-white/10 text-muted-foreground">
                          {cohort.industry}
                        </span>
                      )}
                    </div>
                    {isMember ? (
                      <span className="text-xs text-green-400 font-medium">Joined</span>
                    ) : (
                      <button
                        onClick={() => onJoin(cohort.id)}
                        disabled={isFull || joiningCohort === cohort.id}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium kf-btn-primary disabled:opacity-50"
                      >
                        <UserPlus className="w-3 h-3" />
                        {isFull ? "Full" : "Join"}
                      </button>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
