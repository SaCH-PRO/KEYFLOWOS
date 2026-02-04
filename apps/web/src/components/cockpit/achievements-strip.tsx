"use client";

import { motion } from "framer-motion";
import { 
  Trophy, 
  Star, 
  Zap, 
  TrendingUp, 
  UserPlus, 
  Package, 
  FileText, 
  Calendar, 
  Mail, 
  Share2, 
  Building2, 
  Users, 
  Globe, 
  Award, 
  Flame, 
  CheckCircle,
  LucideIcon
} from "lucide-react";

interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  achieved: boolean;
  achievedAt?: string;
  category: 'setup' | 'sales' | 'growth' | 'engagement' | 'mastery';
  xpReward: number;
}

interface AchievementsStripProps {
  achievements?: Achievement[];
  level?: number;
  currentXp?: number;
  xpToNextLevel?: number;
}

const iconMap: Record<string, LucideIcon> = {
  Trophy,
  Star,
  Zap,
  TrendingUp,
  UserPlus,
  Package,
  FileText,
  Calendar,
  Mail,
  Share2,
  Building2,
  Users,
  Globe,
  Award,
  Flame,
  CheckCircle,
  Quote: FileText,
};

const categoryColors: Record<string, number> = {
  setup: 1,
  sales: 2,
  growth: 1,
  engagement: 2,
  mastery: 1,
};

const defaultAchievements = [
  {
    id: "first-sale",
    icon: "Trophy",
    title: "First Sale",
    description: "Invoice paid – momentum unlocked.",
    achieved: true,
    category: "sales" as const,
    xpReward: 100,
  },
  {
    id: "no-overdue",
    icon: "Star",
    title: "Flawless Flow",
    description: "No overdue invoices this week.",
    achieved: true,
    category: "mastery" as const,
    xpReward: 75,
  },
  {
    id: "first-automation",
    icon: "Zap",
    title: "Automation Ready",
    description: "3 playbooks set up.",
    achieved: true,
    category: "setup" as const,
    xpReward: 100,
  },
  {
    id: "growth-mode",
    icon: "TrendingUp",
    title: "Growth Mode",
    description: "Revenue up 15% this month.",
    achieved: false,
    category: "growth" as const,
    xpReward: 150,
  },
];

export function AchievementsStrip({ 
  achievements, 
  level = 1, 
  currentXp = 0, 
  xpToNextLevel = 500 
}: AchievementsStripProps) {
  const displayAchievements = achievements ?? defaultAchievements;
  const achievedCount = displayAchievements.filter(a => a.achieved).length;
  const totalCount = displayAchievements.length;
  
  const recentAchievements = displayAchievements
    .filter(a => a.achieved)
    .slice(0, 4);

  const nextAchievements = displayAchievements
    .filter(a => !a.achieved)
    .slice(0, 2);

  const displayList = [...recentAchievements, ...nextAchievements].slice(0, 4);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy className="w-5 h-5 text-amber-500" />
          <span className="text-sm font-medium">Achievements</span>
          <span className="text-xs text-muted-foreground">
            {achievedCount}/{totalCount} unlocked
          </span>
        </div>
        {level > 0 && (
          <div className="flex items-center gap-2">
            <div className="text-xs text-muted-foreground">
              Level {level}
            </div>
            <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden">
              <div 
                className="h-full rounded-full bg-amber-500 transition-all"
                style={{ width: `${(currentXp / (currentXp + xpToNextLevel)) * 100}%` }}
              />
            </div>
            <div className="text-xs text-muted-foreground">
              {currentXp} XP
            </div>
          </div>
        )}
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {displayList.map((ach, index) => {
          const Icon = iconMap[ach.icon] || Trophy;
          const accentVar = categoryColors[ach.category] === 1 ? "--kf-accent1" : "--kf-accent2";
          
          return (
            <motion.div
              key={ach.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1 + index * 0.05 }}
              className={`kf-card p-4 flex items-center gap-3 transition-all hover:scale-[1.02] ${!ach.achieved ? "opacity-50" : ""}`}
            >
              <div
                className="h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={ach.achieved ? {
                  background: `hsl(var(${accentVar}))`,
                } : {
                  background: "hsl(var(--kf-muted))",
                }}
              >
                <Icon className="w-5 h-5" style={{ color: ach.achieved ? "white" : "hsl(var(--kf-muted-foreground))" }} />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{ach.title}</div>
                <div className="text-xs text-muted-foreground line-clamp-1">{ach.description}</div>
                {ach.achieved && (
                  <div className="text-xs text-amber-500 mt-0.5">+{ach.xpReward} XP</div>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
