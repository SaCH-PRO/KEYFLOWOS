import { Button } from "@keyflow/ui";
import { ArrowRight, CheckCircle2, Command, Play, Sparkles } from "lucide-react";
import Link from "next/link";

const playbooks = [
  { title: "5-Star Review Flow", steps: ["Invoice paid", "Send review link", "Remind in 24h"] },
  { title: "No-Show Recovery", steps: ["Missed booking", "Send reschedule link", "Offer incentive"] },
  { title: "DM → Booking", steps: ["New DM", "Qualify intent", "Send booking link"] },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-slate-950 to-slate-900 text-foreground">
      <div className="mx-auto max-w-6xl px-6 pb-20">
        {/* Hero */}
        <header className="grid gap-10 lg:grid-cols-2 lg:items-center pt-16">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs text-primary">
              <Sparkles className="w-3.5 h-3.5" />
              AI Autopilot for services
            </div>
            <h1 className="text-4xl md:text-5xl font-semibold leading-tight">
              Turn chaotic service work into a self-running flow.
            </h1>
            <p className="text-lg text-muted-foreground">
              KeyFlowOS is the AI autopilot that moves leads from DM to paid and reviewed — without five different tools.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/app">
                <Button className="text-base px-5 py-3">Start Free Workspace</Button>
              </Link>
              <Button variant="secondary" className="text-base px-5 py-3" asChild>
                <Link href="/public/social">
                  <Play className="w-4 h-4 mr-2" />
                  Watch 90-second tour
                </Link>
              </Button>
            </div>
            <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
              <div className="inline-flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                Cuts no-shows from 30% to 8%
              </div>
              <div className="inline-flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                Leads to booking in 2 steps
              </div>
            </div>
          </div>
          <div className="relative">
            <div className="absolute -inset-6 bg-gradient-to-tr from-primary/20 via-emerald-400/10 to-transparent blur-3xl" />
            <div className="relative rounded-3xl border border-border/70 bg-slate-950/70 shadow-[0_30px_120px_-60px_rgba(0,0,0,0.8)] p-5 space-y-4">
              <div className="rounded-2xl border border-border/60 bg-slate-900/60 p-4 space-y-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Flow Graph</span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-primary">
                    Live
                  </span>
                </div>
                <div className="grid grid-cols-5 gap-2 text-center text-[11px]">
                  {["Lead", "Quote", "Invoice", "Paid", "Review"].map((phase, idx) => (
                    <div key={phase} className="relative">
                      <div className="rounded-2xl border border-border/60 bg-slate-950/80 px-2 py-3 shadow-soft-elevated">
                        <div className="text-xs font-semibold text-foreground">{phase}</div>
                        <div className="text-[10px] text-muted-foreground mt-1">+{idx + 2}</div>
                      </div>
                      {idx < 4 && (
                        <div className="absolute left-full top-1/2 -translate-y-1/2 w-6 h-px bg-gradient-to-r from-primary/40 via-primary to-emerald-400/60" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-2xl border border-primary/40 bg-primary/10 p-4 text-sm">
                <div className="flex items-center gap-2 text-primary font-medium">
                  <Command className="w-4 h-4" />
                  CMD-K Command
                </div>
                <div className="mt-2 rounded-xl bg-slate-950/70 border border-border/60 px-3 py-2 text-muted-foreground">
                  “Send review flow to Invoice #104 and remind in 24h”
                </div>
                <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-emerald-400/50 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-200">
                  Invoice Paid → Send Review Flow?
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Playbook gallery */}
        <section className="mt-16 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">Playbook Gallery</h2>
              <p className="text-sm text-muted-foreground">Drop-in automations that run your day.</p>
            </div>
            <Link href="/app/automations" className="text-primary text-sm inline-flex items-center gap-1">
              View all <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="flex gap-4 overflow-x-auto pb-2">
            {playbooks.map((pb) => (
              <div
                key={pb.title}
                className="min-w-[240px] rounded-2xl border border-border/60 bg-slate-950/70 p-4 space-y-3"
              >
                <div className="text-sm font-semibold text-foreground">{pb.title}</div>
                <div className="space-y-2 text-xs text-muted-foreground">
                  {pb.steps.map((step, idx) => (
                    <div key={step} className="flex items-center gap-2">
                      <div className="h-6 w-6 rounded-full border border-primary/50 bg-primary/10 text-primary flex items-center justify-center text-[11px]">
                        {idx + 1}
                      </div>
                      <span>{step}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Tool maze visual */}
        <section className="mt-16 grid gap-6 lg:grid-cols-2 items-center">
          <div className="rounded-3xl border border-border/60 bg-slate-950/70 p-6 space-y-4">
            <div className="text-sm font-semibold text-foreground">From tool maze → single flow</div>
            <p className="text-sm text-muted-foreground">
              Replace WhatsApp handoffs, Instagram DMs, spreadsheets, and invoicing tabs with one live graph that moves
              every lead forward.
            </p>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-2xl border border-border/60 bg-slate-900/70 p-4 space-y-2">
                <div className="font-semibold text-foreground">Before</div>
                {["WhatsApp", "Instagram", "Excel", "Stripe", "Calendar"].map((tool) => (
                  <div key={tool} className="flex items-center gap-2 text-muted-foreground">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                    {tool}
                  </div>
                ))}
              </div>
              <div className="rounded-2xl border border-primary/40 bg-primary/10 p-4 space-y-2 shadow-glow-primary">
                <div className="font-semibold text-foreground">After</div>
                {["DM → Lead", "Lead → Quote", "Invoice → Paid", "Paid → Review"].map((flow) => (
                  <div key={flow} className="flex items-center gap-2 text-primary">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                    {flow}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="rounded-3xl border border-border/60 bg-slate-950/70 p-6 space-y-4">
            <div className="text-sm font-semibold text-foreground">Social proof</div>
            <div className="space-y-3 text-sm">
              <div className="rounded-2xl border border-border/60 bg-slate-900/70 p-4">
                “Cut no-shows from 30% to 8% in three weeks. The review flow keeps us fully booked.” — Dr. Rahim, Clinic
              </div>
              <div className="rounded-2xl border border-border/60 bg-slate-900/70 p-4">
                “DM to paid in one motion. We ditched four tools and saved hours daily.” — Aisha, Studio founder
              </div>
            </div>
          </div>
        </section>

        {/* Footer CTA */}
        <section className="mt-16 mb-8 rounded-3xl border border-primary/40 bg-gradient-to-r from-primary/10 via-slate-900 to-emerald-400/10 p-6 lg:p-8 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-xl font-semibold">Build your first flow in 5 minutes.</h3>
            <p className="text-sm text-muted-foreground">No credit card. Your workspace is ready instantly.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <input
              type="email"
              placeholder="you@example.com"
              className="rounded-2xl bg-slate-950/80 border border-border/60 px-4 py-3 text-sm focus:border-primary focus:outline-none"
            />
            <Button className="px-5 py-3 text-base">Start Free Workspace</Button>
          </div>
        </section>
      </div>
    </div>
  );
}
