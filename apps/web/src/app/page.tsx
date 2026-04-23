"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  Zap,
  Calendar,
  DollarSign,
  Users,
  ArrowRight,
  Layers,
  BarChart3,
  Bot,
  ShoppingBag,
  Mail,
  Globe,
  Check,
  ChevronRight,
  Play,
  Shield,
  Clock,
  TrendingUp,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";

const MODULES = [
  { icon: Bot, title: "Start each day with clear priorities", desc: "Control Tower surfaces what matters now: risks, approvals, and next best actions so you stop guessing.", color: "from-orange-500/20 to-amber-500/20", iconColor: "text-orange-400" },
  { icon: Users, title: "Stop losing leads to silence", desc: "Track stale leads and launch follow-ups faster, with AI-ready drafts when your pipeline cools down.", color: "from-blue-500/20 to-cyan-500/20", iconColor: "text-blue-400" },
  { icon: ShoppingBag, title: "Collect cash faster", desc: "See overdue invoices early, send reminders quickly, and keep your revenue cycle moving.", color: "from-emerald-500/20 to-green-500/20", iconColor: "text-emerald-400" },
  { icon: Calendar, title: "Fill your calendar predictably", desc: "Publish booking experiences, prevent missed confirmations, and monitor utilization in one flow.", color: "from-violet-500/20 to-purple-500/20", iconColor: "text-violet-400" },
  { icon: BarChart3, title: "Know business health at a glance", desc: "Turn messy operations data into signals you can act on today, not just dashboards you admire.", color: "from-rose-500/20 to-pink-500/20", iconColor: "text-rose-400" },
  { icon: Mail, title: "Execute growth actions with confidence", desc: "Run practical campaigns and reminders from one place instead of stitching together disconnected tools.", color: "from-teal-500/20 to-cyan-500/20", iconColor: "text-teal-400" },
];

const STATS = [
  { value: "1", label: "Daily command center" },
  { value: "<5 min", label: "Daily operator check-in" },
  { value: "TTD", label: "Caribbean-ready finance" },
  { value: "24/7", label: "Business visibility" },
];

const STEPS = [
  { num: "01", title: "Set your operating profile", desc: "Tell us your business type, your biggest pain, and what you want automated first." },
  { num: "02", title: "Launch your first workflow", desc: "Publish your first offering and go live with the core flow that drives immediate value." },
  { num: "03", title: "Complete one first win", desc: "Send an invoice, launch follow-ups, or publish bookings in your very first session." },
];

function useTypingEffect(words: string[], speed = 100, pause = 2000) {
  const [text, setText] = useState("");
  const [wordIndex, setWordIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const currentWord = words[wordIndex];
    const timeout = setTimeout(() => {
      if (!isDeleting) {
        setText(currentWord.slice(0, text.length + 1));
        if (text.length + 1 === currentWord.length) {
          setTimeout(() => setIsDeleting(true), pause);
        }
      } else {
        setText(currentWord.slice(0, text.length - 1));
        if (text.length === 0) {
          setIsDeleting(false);
          setWordIndex((i) => (i + 1) % words.length);
        }
      }
    }, isDeleting ? speed / 2 : speed);
    return () => clearTimeout(timeout);
  }, [text, isDeleting, wordIndex, words, speed, pause]);

  return text;
}

const fadeUp = { hidden: { opacity: 0, y: 24 }, visible: { opacity: 1, y: 0 } };
const stagger = { visible: { transition: { staggerChildren: 0.08 } } };

export default function Home() {
  const typedWord = useTypingEffect(["autopilot", "confidence", "intelligence", "ease"], 80, 2200);

  return (
    <div className="relative min-h-screen bg-[hsl(20_14%_4%)] text-[hsl(30_20%_98%)] overflow-hidden">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute -top-60 right-0 w-[700px] h-[700px] rounded-full bg-[radial-gradient(circle,hsl(24_95%_53%/0.1),transparent_65%)]" />
        <div className="absolute -bottom-40 -left-40 w-[600px] h-[600px] rounded-full bg-[radial-gradient(circle,hsl(173_58%_39%/0.07),transparent_65%)]" />
      </div>

      <nav className="sticky top-0 z-50 border-b border-white/[0.06] bg-[hsl(20_14%_4%/0.8)] backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-gradient-to-br from-[hsl(24_95%_53%)] to-[hsl(173_58%_39%)]">
              <Layers className="w-4.5 h-4.5 text-white" />
            </div>
            <span className="text-lg font-bold tracking-tight">KeyFlowOS</span>
          </Link>
          <div className="flex items-center gap-2 sm:gap-4">
            <Link href="/pricing" className="hidden sm:inline-block text-sm text-[hsl(30_10%_55%)] hover:text-[hsl(30_20%_85%)] transition-colors">
              Pricing
            </Link>
            <Link href="/auth/login" className="text-sm text-[hsl(30_10%_55%)] hover:text-[hsl(30_20%_85%)] transition-colors">
              Log in
            </Link>
            <Link href="/auth/signup"
              className="px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-r from-[hsl(24_95%_53%)] to-[hsl(24_95%_45%)] hover:brightness-110 transition-all">
              Start Free
            </Link>
          </div>
        </div>
      </nav>

      <section className="relative z-10 max-w-6xl mx-auto px-5 sm:px-8 pt-20 sm:pt-28 pb-20">
        <motion.div
          initial="hidden" animate="visible" variants={stagger}
          className="text-center max-w-3xl mx-auto mb-16"
        >
          <motion.div variants={fadeUp} transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[hsl(24_95%_53%/0.08)] border border-[hsl(24_95%_53%/0.15)] text-sm font-medium text-[hsl(24_95%_63%)] mb-6">
            <Sparkles className="w-3.5 h-3.5" />
            Daily Business Autopilot
          </motion.div>

          <motion.h1 variants={fadeUp} transition={{ duration: 0.6 }}
            className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold leading-[1.08] mb-6 tracking-tight">
            Run your business
            <br />
            <span className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl">with </span>
            <span className="bg-gradient-to-r from-[hsl(24_95%_53%)] to-[hsl(173_58%_50%)] bg-clip-text text-transparent">
              {typedWord}
              <span className="inline-block w-[3px] h-[0.85em] bg-[hsl(24_95%_53%)] ml-0.5 align-middle animate-pulse" />
            </span>
          </motion.h1>

          <motion.p variants={fadeUp} transition={{ duration: 0.5 }}
            className="text-base sm:text-lg text-[hsl(30_10%_55%)] max-w-xl mx-auto mb-10 leading-relaxed">
            KeyFlowOS helps service businesses run the day from one command center — what is at risk, what will make money, and what to do next.
          </motion.p>

          <motion.div variants={fadeUp} transition={{ duration: 0.5 }}
            className="flex flex-col sm:flex-row gap-3 justify-center items-center">
            <Link href="/auth/signup"
              className="group w-full sm:w-auto px-7 py-3.5 rounded-xl bg-gradient-to-r from-[hsl(24_95%_53%)] to-[hsl(24_95%_45%)] hover:brightness-110 font-semibold text-base transition-all flex items-center justify-center gap-2 shadow-lg shadow-orange-500/20">
              Get Started Free
              <ArrowRight className="w-4.5 h-4.5 group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <Link href="/app"
              className="group w-full sm:w-auto px-7 py-3.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.08] font-semibold text-base transition-all flex items-center justify-center gap-2">
              <Play className="w-4 h-4 text-[hsl(24_95%_53%)]" />
              View Demo
            </Link>
          </motion.div>
        </motion.div>

        <motion.div
          initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-50px" }} variants={stagger}
          className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-24"
        >
          {STATS.map(({ value, label }) => (
            <motion.div key={label} variants={fadeUp} transition={{ duration: 0.4 }}
              className="text-center py-5 px-3 rounded-xl border border-white/[0.06] bg-white/[0.02]">
              <p className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-[hsl(24_95%_53%)] to-[hsl(173_58%_50%)] bg-clip-text text-transparent">{value}</p>
              <p className="text-xs sm:text-sm text-[hsl(30_10%_45%)] mt-1">{label}</p>
            </motion.div>
          ))}
        </motion.div>
      </section>

      <section className="relative z-10 max-w-6xl mx-auto px-5 sm:px-8 pb-24">
        <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }} variants={stagger}>
          <motion.div variants={fadeUp} transition={{ duration: 0.5 }} className="text-center mb-12">
            <p className="text-xs font-semibold uppercase tracking-widest text-[hsl(24_95%_53%)] mb-3">Outcome-led operations</p>
            <h2 className="text-3xl sm:text-4xl font-bold mb-3">One cockpit. Clear daily outcomes.</h2>
            <p className="text-[hsl(30_10%_50%)] max-w-lg mx-auto">Built for owners who need fast execution, not another maze of disconnected admin tools.</p>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
            {MODULES.map(({ icon: Icon, title, desc, color, iconColor }, i) => (
              <motion.div
                key={title}
                variants={fadeUp}
                transition={{ duration: 0.4 }}
                className="group p-5 sm:p-6 rounded-2xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.1] transition-all cursor-default"
              >
                <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center mb-4`}>
                  <Icon className={`w-5 h-5 ${iconColor}`} />
                </div>
                <h3 className="text-base font-semibold mb-2">{title}</h3>
                <p className="text-sm text-[hsl(30_10%_45%)] leading-relaxed">{desc}</p>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </section>

      <section className="relative z-10 max-w-6xl mx-auto px-5 sm:px-8 pb-24">
        <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }} variants={stagger}>
          <motion.div variants={fadeUp} transition={{ duration: 0.5 }} className="text-center mb-12">
            <p className="text-xs font-semibold uppercase tracking-widest text-[hsl(173_58%_50%)] mb-3">How It Works</p>
            <h2 className="text-3xl sm:text-4xl font-bold mb-3">Live in 3 steps</h2>
            <p className="text-[hsl(30_10%_50%)] max-w-lg mx-auto">From setup to first measurable win — with clear guidance at each step.</p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-5 sm:gap-6">
            {STEPS.map(({ num, title, desc }, i) => (
              <motion.div key={num} variants={fadeUp} transition={{ duration: 0.4 }}
                className="relative p-6 rounded-2xl border border-white/[0.06] bg-white/[0.02]">
                <span className="text-4xl font-black bg-gradient-to-b from-[hsl(24_95%_53%/0.3)] to-transparent bg-clip-text text-transparent absolute top-4 right-5">{num}</span>
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[hsl(24_95%_53%/0.15)] to-[hsl(173_58%_39%/0.1)] flex items-center justify-center mb-4">
                  {i === 0 && <Zap className="w-5 h-5 text-[hsl(24_95%_53%)]" />}
                  {i === 1 && <Bot className="w-5 h-5 text-[hsl(24_95%_53%)]" />}
                  {i === 2 && <TrendingUp className="w-5 h-5 text-[hsl(24_95%_53%)]" />}
                </div>
                <h3 className="text-lg font-semibold mb-2">{title}</h3>
                <p className="text-sm text-[hsl(30_10%_45%)] leading-relaxed">{desc}</p>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </section>

      <section className="relative z-10 max-w-6xl mx-auto px-5 sm:px-8 pb-24">
        <motion.div
          initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }} variants={stagger}
          className="text-center"
        >
          <motion.div variants={fadeUp} transition={{ duration: 0.5 }}
            className="rounded-3xl border border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-white/[0.01] p-10 sm:p-14">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">Ready to run your business in minutes a day?</h2>
            <p className="text-[hsl(30_10%_50%)] max-w-md mx-auto mb-8">
              Start with one urgent outcome, then unlock the full platform as your business grows.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center items-center mb-8">
              <Link href="/auth/signup"
                className="group w-full sm:w-auto px-8 py-3.5 rounded-xl bg-gradient-to-r from-[hsl(24_95%_53%)] to-[hsl(24_95%_45%)] hover:brightness-110 font-semibold text-base transition-all flex items-center justify-center gap-2 shadow-lg shadow-orange-500/20">
                Start Free — No Credit Card
                <ArrowRight className="w-4.5 h-4.5 group-hover:translate-x-0.5 transition-transform" />
              </Link>
            </div>
            <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-[hsl(30_10%_45%)]">
              <span className="flex items-center gap-1.5"><Check className="w-4 h-4 text-emerald-400" /> Free forever plan</span>
              <span className="flex items-center gap-1.5"><Check className="w-4 h-4 text-emerald-400" /> No credit card</span>
              <span className="flex items-center gap-1.5"><Check className="w-4 h-4 text-emerald-400" /> Setup in 2 minutes</span>
            </div>
          </motion.div>
        </motion.div>
      </section>

      <footer className="relative z-10 border-t border-white/[0.06]">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-gradient-to-br from-[hsl(24_95%_53%)] to-[hsl(173_58%_39%)]">
              <Layers className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-sm font-semibold text-[hsl(30_10%_45%)]">KeyFlowOS</span>
          </div>
          <p className="text-xs text-[hsl(30_10%_30%)]">Your business, on autopilot.</p>
          <div className="flex items-center gap-4 text-xs text-[hsl(30_10%_35%)]">
            <Link href="/pricing" className="hover:text-[hsl(30_10%_60%)] transition-colors">Pricing</Link>
            <Link href="/auth/login" className="hover:text-[hsl(30_10%_60%)] transition-colors">Log in</Link>
            <Link href="/auth/signup" className="hover:text-[hsl(30_10%_60%)] transition-colors">Sign up</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
